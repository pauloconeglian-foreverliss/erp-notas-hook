require('dotenv').config();

async function connect() {
  if (global.connection)
    return global.connection.connect();
  
  const { Pool } = require('pg');

  const pool = new Pool({
		user: process.env.POSTGRESQL_USER,
		host: process.env.POSTGRESQL_HOST,
		database: process.env.POSTGRESQL_DATA,
		password: process.env.POSTGRESQL_PASS,
		port: process.env.POSTGRESQL_PORT
	});
  
  const client = await pool.connect();
  console.log('Pool de conexão criado.');

  const res = await client.query('SELECT NOW()');
  console.log(res.rows[0]);
  client.release();

  global.connection = pool;
  return pool.connect();
};
  
async function selectOrders() {
  const client = await connect();
  const res = await client.query(`
    SELECT       
      od.sequence, od.order_total, od.item_total, od.discount, od.shipping, od.delivery_company,
      cl.first_name, cl.last_name, cl.email, cl.document_type, cl.document, cl.home_phone, cl.is_corporate, cl.corporate_name, cl.corporate_doc, cl.trade_name, cl.state_registration,
      ad.receiver_name, ad.postal_code, ad.street, ad.number, ad.neighborhood, ad.city, ad.state, ad.country, ad.complement,
      tr.nome, tr.cnpj, tr.logradouro, tr.estado, tr.cidade
    FROM erp.order AS od
    INNER JOIN erp.client AS cl ON od.user_id = cl.user_id
    INNER JOIN erp.address AS ad ON ad.address_id = od.address_id
    INNER JOIN erp.transportadoras AS tr ON tr.frete = od.delivery_company
    WHERE od.status='ready-for-handling'
  `);

  return orders = res.rows;
}

async function selectOrderItems(order, sequence) {
  const client = await connect();
  console.log('*************************************');
  console.log('selectOrderItems sequence', sequence);
  
  const res = await client.query(`
    SELECT *, pr.perfil_imposto AS perfil_imposto_id, tf.frete_produto_total, (it.quantity * it.price) AS frete_produto_uni
    FROM erp.order_items AS it
    CROSS JOIN ( SELECT SUM(quantity * price) AS frete_produto_total FROM erp.order_items WHERE sequence='${sequence}' ) AS tf
    INNER JOIN erp.product AS pr ON pr.reference_id = it.ref_id
    INNER JOIN erp.cest AS ct ON ct.cest_id = pr.cest_id
    INNER JOIN erp.perfil_imposto AS pi ON pi.perfil_imposto = pr.perfil_imposto
    WHERE it.sequence='${sequence}'
  `);

  return orderItems = res.rows;
}

async function selectTabelao(order, item) {  
  const client = await connect();
  const state = (order.state).trim();    
  let contribuinte = false;
  let sigla_origem = null;

  /* Verifica se cliente é contibuinte */
  if ( order.corporate_doc !== null && order.state_registration !== null ) {
    contribuinte = true;
  }
  
  /* Define sigla_origem */
  sigla_origem = ( order.state === 'SP') ? 'SP' : 'MG';
  
  const res = await client.query(`
    SELECT *
    FROM erp.tabelao_test4 AS tb
    WHERE tb.ncm_id='${item.ncm_id}'
      AND tb.sigla='${state}' 
      AND tb.sigla_origem='${sigla_origem}'
      AND tb.tipo_produto='${item.class_prod}'
      AND tb.contribuinte=${contribuinte}
      AND tb.cest_code='${item.cest_code}'
      AND tb.perfil_imposto='${item.perfil_imposto_id}'
      AND tb.reference_id='${item.reference_id}'      
  `);

  return tabelao = res.rows;
}

const formataTelefone = (fone) => {
  if ( fone.indexOf('+') !== -1 && fone.length > 11 ) {
    return fone.replace(/\+/g, "").substr(2);
  }

  return fone;
}

async function payloadSend(order, orderItems) {
  //const axios = require('axios');
  const fullName = `${order.first_name} ${order.last_name}`;
  const cpfCnpj = order.corporate_doc !== null ? order.corporate_doc : order.document;
  const tipoPessoa = order.corporate_doc !== null ? "J" : "F";
  const sequence = `teste-${order.sequence}`;  
  const telefone = formataTelefone(order.home_phone);
  let itemsObject = [];
  let orderWeight = 0;
  let cfop = null;
  let frete_produto_total = 0;

  console.log('orderItems', orderItems.length);

  for (const item of orderItems) {
    orderWeight = orderWeight + item.weight;
    const brinde = item.selling_price == 0 ? " (BRINDE)" : "";    
    const tabelao = await selectTabelao(order, item);
    const tb = tabelao[0];
    let frete_final_produto, frete_rateio_produto, percentualMargemValorAdicionadoST = null;  
    
    /* Calculo Frete produto individual */
    frete_produto_total = item.frete_produto_total;
    frete_rateio_produto = ( item.frete_produto_uni / frete_produto_total );
    frete_final_produto = ( item.shipping * frete_rateio_produto );

    console.log('frete_produto_uni', frete_final_produto);

    /* percentualMargemValorAdicionadoST */
    if ( tb.subst_icms_ajust !== null) {
      percentualMargemValorAdicionadoST = tb.subst_icms_ajust;
    } else if ( tb.subst_icms !== null ) {
      percentualMargemValorAdicionadoST = tb.subst_icms;
    }

    /* Verificação CFOP */
    if ( order.state == 'SP' || order.state == 'MG' ) {
      cfop = tb.cfop_estadual;
    }
    else {
      cfop = tb.cfop_interestadual;
    }

    itemsObject.push(
    {
      "cfop": cfop,
      "codigo": item.reference_id,
      "descricao": `${(item.name).toUpperCase()}${brinde}`,
      "sku": item.id,
      "ncm": tb.ncm_id,
      "cest": tb.cest_code,
      "quantidade": item.quantity,
      "unidadeMedida": "UN",
      "valorUnitario": item.price,
      "frete": frete_final_produto,
      "impostos": {
        "percentualAproximadoTributos": {
          "simplificado": {
            "percentual": 0
          },          
          "fonte": ""
        },
        "icms": {
          "situacaoTributaria": tb.cst,
          "origem": 0,
          "aliquota": tb.al_icms,
          "baseCalculo": 0,
          "modalidadeBaseCalculo": 0,
          "percentualReducaoBaseCalculo": tb.red_icms,
          "baseCalculoST": 0,
          "aliquotaST": tb.al_icmss,
          "modalidadeBaseCalculoST": 0,
          "percentualReducaoBaseCalculoST": 0,
          "percentualMargemValorAdicionadoST": percentualMargemValorAdicionadoST
        },
        "pis": {
          "situacaoTributaria": tb.sit_trib_pis_sai,
          "porAliquota": {
            "aliquota": 0
          }
        },
        "cofins": {
          "situacaoTributaria": tb.sit_trib_cofins_sai,
          "porAliquota": {
            "aliquota": 0
          }
        },
        "ipi": {
          "situacaoTributaria": tb.sit_trib_ipi_sai,
          "porAliquota": {
            "aliquota": 0
          }
        }
      },
      "informacoesAdicionais": `SIGLA ORIGEM: ${tb.sigla_origem}`
    });
  };    
    
  orderWeight = parseFloat(orderWeight).toFixed(2);

  const data = {
    "id": sequence,
    "ambienteEmissao": "Homologacao",
    "tipoOperacao": "Saida",
    "naturezaOperacao": "VENDA MERC SUJEITA ST",
    "finalidade": "Normal",
    "consumidorFinal": tipoPessoa === "F" ? true : false,
    "enviarPorEmail": true,
    "indicadorPresencaConsumidor": "NaoSeAplica",
    "cliente": {
      "tipoPessoa": tipoPessoa,
      "indicadorContribuinteICMS": "NaoContribuinte",
      "nome": fullName,
      "email": order.email,
      "telefone": telefone,
      "cpfCnpj": cpfCnpj,
      "inscricaoMunicipal": null,
      "inscricaoEstadual": order.state_registration,
      "endereco": {
        "uf": order.state,
        "cidade": order.city,
        "logradouro": order.street,
        "numero": order.number,
        "complemento": order.complement,
        "bairro": order.neighborhood,
        "cep": order.postal_code
      }
    },
    "itens": itemsObject,
    "transporte": {
      "frete": {
        "modalidade": "0"
      },
      "enderecoEntrega": {
        "tipoPessoaDestinatario": tipoPessoa,
        "cpfCnpjDestinatario": cpfCnpj,
        "pais": order.country,
        "uf": order.state,
        "cidade": order.city,
        "logradouro": order.street,
        "numero": order.number,
        "complemento": order.complement,
        "bairro": order.neighborhood,
        "cep": order.postal_code
      },
      "transportadora": {
        "usarDadosEmitente": true,
        "tipoPessoa": "J",
        "cpfCnpj": order.cnpj,
        "nome": order.nome,
        "inscricaoEstadual": null,
        "enderecoCompleto": order.logradouro,
        "uf": (order.estado).trim(),
        "cidade": order.cidade
      },
      "volume": {
        "quantidade": orderItems.length,
        "especie": "VOLUMES",
        "marca": "",
        "numeracao": "1",
        "pesoBruto": orderWeight,
        "pesoLiquido": orderWeight
      }
    },
    "informacoesAdicionais": `NUMERO DO PEDIDO: FOR-${sequence};|-ICMS COBRADO ANTERIORMENTE POR SUBSTITUICAO TRIBUTARIA-IMPOSTOS PAGOS (FEDERAL  R$ 14.98, ESTADUAL  R$ 11.90, TOTAL R$ 26.88)`
  };

  console.log(`frete_produto_total: ${frete_produto_total}`);
  //return JSON.stringify(data);

  // var config = {
  //   method: 'post',
  //   url: 'https://api.enotasgw.com.br/v2/empresas/{{ID_EMPRESA}}/nf-e',
  //   headers: { 
  //     'Accept': 'application/json', 
  //     'Authorization': 'Basic {{API_KEY}}', 
  //     'Content-Type': 'application/json'
  //   },
  //   data : data
  // };

  // axios(config)
  //   .then(function (response) {
  //     console.log(JSON.stringify(response.data));
  //   })
  //   .catch(function (error) {
  //     console.log(error);
  //   });
}
  
module.exports = { selectOrders, selectOrderItems, payloadSend }
