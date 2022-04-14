/*
  Calculos
  --------

  - Para referência do calculo de rateio de preço dos kits, consultar:
  https://docs.google.com/spreadsheets/d/1EonErQbGWh6ElbiWgD7nK-iJGtOYNPRCv2j9oK9VYXk/edit#gid=1203929356

  - Para referência de calculo de ratio de frete, constultar:
  https://docs.google.com/spreadsheets/d/1EonErQbGWh6ElbiWgD7nK-iJGtOYNPRCv2j9oK9VYXk/edit#gid=1277870709
*/

const { ClientBase } = require('pg');
const db = require('./db');

function dumpError(err) {
  if (typeof err === 'object') {
    if (err.message) {
      console.log('\nMessage: ' + err.message);
    }
    if (err.stack) {
      console.log('\nStacktrace:');
      console.log('====================');
      console.log(err.stack);
    }
  } else {
    console.log('dumpError :: argument is not an object');
  }
}

const formataTelefone = (fone) => {
  if ( fone.indexOf('+') !== -1 && fone.length > 11 ) {
    return fone.replace(/\+/g, "").substr(2);
  }

  return fone;
}

async function selectOrders() {
  try {
    const client = await db.connect();
    const res = await client.query(`
      SELECT
        od.authorized_date, od.sequence, od.order_total, od.item_total, od.discount, od.shipping, od.delivery_company, od.hostname, od.invoiced_date,
        cl.first_name, cl.last_name, cl.email, cl.document_type, cl.document, cl.phone, cl.is_corporate, cl.corporate_document, cl.state_inscription,
        ad.receiver_name, ad.postal_code, ad.street, ad.number, ad.neighborhood, ad.city, ad.state, ad.country, ad.complement,
        tr.nome, TRIM(tr.cnpj) AS cnpj, tr.logradouro, TRIM(tr.estado) AS estado, tr.cidade,
        fi.enotas_id, fi.enotas_api_key,
        ies.inscription_code
      FROM erp.order AS od
      JOIN erp.order_client AS cl ON cl.sequence = od.sequence
      JOIN erp.order_logistic AS ad ON ad.sequence = od.sequence
      JOIN erp.transportadoras AS tr ON tr.frete = od.delivery_company
      JOIN erp.de_para_filial AS dpfi
        ON dpfi.warehouse_id = od.vtex_warehouse_id
        AND dpfi.hostname = od.hostname
      JOIN erp.filiais AS fi ON fi.filial_id = dpfi.filial_id
      LEFT JOIN erp.insc_estadual_sub AS ies
        ON ies.id_filial = fi.filial_id
        AND ies.state = ad.state
      WHERE
        od.status='ready-for-handling'
        AND od.invoiced_date IS NULL
        AND od.sequence = 54076125
      ORDER BY od.authorized_date ASC
    `);
    
    return orders = res.rows;
  } catch(err) {
    dumpError(err);
  }
}

async function selectTabelao(order, item) {
  try {    
    const client = await db.connect();
    const state = (order.state).trim();
    let contribuinte = false;
    let sigla_origem = null;
    
    // Verifica se cliente é contibuinte
    if ( order.corporate_document !== null && order.state_inscription !== null ) {
      contribuinte = true;
    }

    // Define sigla_origem
    sigla_origem = ( order.state !== 'SP') ? 'MG' : 'SP';

    const res = await client.query(`
      SELECT *
      FROM erp.tabelao_test4 AS tb
      JOIN erp.icms AS ic ON ic.uf = tb.sigla
      JOIN erp.ibpt_api AS ib ON 
        ib.cest_id = ${item.cest_id} 
        AND ib.codigo = ${item.ncm_id}
        AND ib.estado = '${state}'
      WHERE 
        tb.ncm_id = ${item.ncm_id}
        AND tb.sigla = '${state}' 
        AND tb.sigla_origem = '${sigla_origem}'
        AND tb.tipo_produto = '${item.class_prod}'
        AND tb.contribuinte = ${contribuinte}
        AND tb.cest_code = '${item.cest_code}'
        AND tb.perfil_imposto = ${item.perfil_imposto}
        AND tb.reference_id = '${item.reference_id}'
    `);

    return tabelao = res.rows;
  } catch(err) {    
    dumpError(err);
  }
}

async function setItemsKitQuantity(order, kit_product_id) {
  const client = await db.connect();
  const res = await client.query(`
    SELECT COUNT(kit_product_id) AS total_items_kit
      FROM erp.order_items it
      JOIN erp.product pr ON pr.reference_id = it.ref_id
      JOIN erp.vitrine vt ON vt.sku_id = it.id
      JOIN erp.product_kit pk ON pk.kit_product_id = vt.product_id
    WHERE
      pr.is_kit = TRUE
      AND it.sequence = ${order.sequence}
      AND vt.hostname = '${order.hostname}'
      AND pk.kit_product_id  = ${kit_product_id}
    GROUP BY kit_product_id
  `);

  return res.rows[0].total_items_kit;
}

async function setItemsKitTotalPrice(order, kit_product_id) {
  const client = await db.connect();
  const res = await client.query(`
    SELECT 
      SUM(pc.preco) AS total_kit_price
    FROM erp.vitrine vt
    LEFT JOIN erp.product_kit pk ON pk.kit_product_id = vt.product_id
    LEFT JOIN erp.product pr ON pr.product_id = pk.product_id
    LEFT JOIN erp.preco pc ON pc.tabela = vt.table_price_id AND pc.reference_id = pr.reference_id
    WHERE
      pk.kit_product_id = ${kit_product_id}
      AND vt.hostname = '${order.hostname}'
  `);

  return res.rows[0].total_kit_price;
}

async function selectItems(order) {
  try {
    const client = await db.connect();
    const res = await client.query(`
      SELECT
        CASE WHEN pr.is_kit = TRUE THEN pr2.ncm_id ELSE pr.ncm_id END AS ncm_id,
        CASE WHEN pr.is_kit = TRUE THEN pr2.class_prod ELSE pr.class_prod END AS class_prod,
        CASE WHEN pr.is_kit = TRUE THEN ct2.cest_code ELSE ct.cest_code END AS cest_code,
        CASE WHEN pr.is_kit = TRUE THEN ct2.cest_id ELSE ct.cest_id END AS cest_id,
        CASE WHEN pr.is_kit = TRUE THEN pi2.perfil_imposto ELSE pi.perfil_imposto END AS perfil_imposto,
        CASE WHEN pr.is_kit = TRUE THEN pr2.reference_id ELSE it.ref_id END AS reference_id,
        CASE WHEN pr.is_kit = TRUE THEN ( it.quantity * pk.quantity ) ELSE it.quantity END AS quantity,
        CASE WHEN pr.is_kit = TRUE THEN UPPER(pr2.name) ELSE UPPER(it.name) END AS name,
        CASE WHEN pr.is_kit = TRUE THEN vt2.sku_id ELSE it.id END AS sku_id,
        CASE WHEN pr.is_kit = TRUE THEN pc.preco ELSE it.selling_price END AS price,
        CASE WHEN pr.is_kit = TRUE THEN pr2.product_id ELSE pr.product_id END AS product_id,
        CASE WHEN pr.is_kit = TRUE THEN ( pr2.weight * (it.quantity * pk.quantity) ) ELSE ( pr.weight * it.quantity) END AS product_weight,        
        it.price AS order_price, it.shipping, it.selling_price, it.quantity AS order_item_quantity, ( it.price - it.selling_price ) AS discount, pr.is_kit, vt.sku_id, pk.kit_product_id, pr2.reference_id AS reference_id_comp, it.ref_id AS ref_id_comp
      FROM erp.order_items it      
      JOIN erp.product pr ON pr.reference_id = it.ref_id
      JOIN erp.cest AS ct ON ct.cest_id = pr.cest_id
      JOIN erp.perfil_imposto pi ON pi.perfil_imposto = pr.perfil_imposto      
      JOIN erp.vitrine vt ON vt.sku_id = it.id
      LEFT JOIN erp.product_kit pk ON pk.kit_product_id = vt.product_id
      LEFT JOIN erp.product pr2 ON pr2.product_id = pk.product_id
      LEFT JOIN erp.preco pc ON pc.tabela = vt.table_price_id AND pc.reference_id = pr2.reference_id
      LEFT JOIN erp.cest ct2 ON ct2.cest_id = pr2.cest_id
      LEFT JOIN erp.perfil_imposto AS pi2 ON pi2.perfil_imposto = pr2.perfil_imposto
      LEFT JOIN erp.vitrine vt2 ON vt2.product_id = pr2.product_id AND vt2.hostname = '${order.hostname}'      
      WHERE
        it.sequence = ${order.sequence}
        AND vt.hostname = '${order.hostname}'                      
    `);

    const orderItems = res.rows;
    
    return await setOrderItemsKitJson(order, orderItems);
  }
  catch(err) {
    dumpError(err);
  }
}

async function uniqItems(data, key) {
  return [
    ...new Map(
      data.map(x => [key(x), x])
    ).values()
  ]
}

// retorna preço já fracionado mais total
async function getPrice(order, item) {  
  let price = ( item.price / 100 );
  let itemsKitLength = 0;
  if ( item.is_kit === true ) {
    itemsKitLength = await setItemsKitQuantity(order, item.kit_product_id);
    totalPriceItemsKit = await setItemsKitTotalPrice(order, item.kit_product_id);                      

    if ( itemsKitLength > 1 ) {        
      // KITS
      // O rateio de desconto para os items do kit
      let discount = item.discount > 0 ? ( item.discount / 100 ) : 0;
      let discountAverage = (discount / itemsKitLength);
      
      let iq = itemQuantity = item.quantity;
      let opp = orderProductPrice = ( item.order_price / 100 );
      let opq = orderProductQuantity = item.order_item_quantity;
      let oppt = orderProductPriceTotal = ( opp * opq );
      let pkip = productsKitItemsPrice = ( item.price * iq );
      let pkipt = productsKitItemsPriceTotal = ( totalPriceItemsKit * iq );
      let pik = percentageItemsKit = ( pkip / pkipt );
      price = ((( pik * oppt ) / iq ) - discountAverage);
    } else {
      // COMBOS (kits com os mesmos produtos)
      // O rateio de desconto para todos os itens do combo
      let discount = item.discount > 0 ? ( item.discount / 100 ) : 0;
      let discountAverage = (discount / item.quantity);
      
      let iq = itemQuantity = item.quantity;
      let opp = orderProductPrice = ( item.order_price / 100 );
      let opq = orderProductQuantity = item.order_item_quantity;
      let oppt = orderProductPriceTotal = ( opp * opq );
      price = (( oppt / iq ) - discountAverage );        
    }                
  }

  // Verifica preço brindes
  if ( item.selling_price == 0 ) {
    price = ( item.order_price / 100 );    
  }

  return price;  
}

async function gettotalOrderPrice(order, orderItems) {
  let price = 0;
  let totalPrice = 0;
  for ( const item of orderItems ) {
    price = await getPrice(order, item);
    totalPrice = (price * item.quantity) + totalPrice;
  }

  return totalPrice;
}

async function setOrderItemsKitJson(order, orderItems) {
  let orderItemKitObj = [];
  let orderPrice = 0;
  let orderPriceBrinde = 0;

  // Remove produtos duplicados
  const orderItemsUniq = await uniqItems(orderItems, it => it.reference_id);

  const weight = orderItemsUniq.reduce(function(sum, current) {
    return ( sum + current.product_weight );
  }, 0);  

  let totalOrderPrice = await gettotalOrderPrice(order, orderItemsUniq);
  
  for ( const item of orderItemsUniq ) {
    const skuProduct = item.sku_id;
    const is_brinde = item.selling_price == 0 ? true : false;
    const brinde = is_brinde ? " (BRINDE)" : "";    
    let cfop = null;    
    let baseCalculo = 0;
    let baseCalculoST = 0;
    let aliquotaST = 0;
    let modalidadeBaseCalculoST = 0; 
    let percentualReducaoBaseCalculoST = 0;
    let percentualMargemValorAdicionadoST = 0;
    let price = await getPrice(order, item);

    // Soma total brindes
    if ( is_brinde ) {      
      orderPriceBrinde = item.order_price + orderPriceBrinde;
    }

    // Calculo Frete
    let orderTotalPriceProducts = ( price * item.quantity );
    let averagePercentage = ( orderTotalPriceProducts / totalOrderPrice );
    let shipping = ( averagePercentage * order.shipping ) / 100;
    shipping = parseFloat(shipping.toFixed(2));
    baseCalculo = (( price * item.quantity ) + shipping );

    const tabela = await selectTabelao(order, item);
    const tb = tabela[0];

    // percentualMargemValorAdicionadoST
    if ( tb.subst_icms_ajust !== null) {
      percentualMargemValorAdicionadoST = tb.subst_icms_ajust;
    } else if ( tb.subst_icms !== null ) {
      percentualMargemValorAdicionadoST = tb.subst_icms;
    }

    // Verificação CFOP - REFAZER!!!!!!!!!!!!!!!!!!!!!!!!!
    if ( order.state == 'SP' || order.state == 'MG' ) {
      cfop = is_brinde ? "5910" : tb.cfop_estadual;
    } else {
      cfop = is_brinde ? "6910" : tb.cfop_interestadual;
    }

    // Campos Pessoa Jurídica / CNPJ+IE
    if ( tb.contribuinte === true ) {
      baseCalculoST = parseFloat(((( baseCalculo * percentualMargemValorAdicionadoST ) + baseCalculo ) / 100).toFixed(2));
      aliquotaST = tb.al_icmss;
      modalidadeBaseCalculoST = 4;
      percentualReducaoBaseCalculoST = 0;
      percentualMargemValorAdicionadoST = percentualMargemValorAdicionadoST;
    }
    
    const orderItemKit = [{
      "cfop": cfop.toString(),
      "codigo": item.reference_id,
      "descricao": `${(item.name).toUpperCase()}${brinde}`,
      "sku": (skuProduct).toString(),
      "ncm": (tb.ncm_id).toString(),
      "cest": tb.cest_code,
      "quantidade": item.quantity,
      "unidadeMedida": "UN",
      "valorUnitario":  parseFloat(price.toFixed(2)),
      "frete": parseFloat(shipping.toFixed(2)),
      "impostos": {
        "percentualAproximadoTributos": {
          "detalhado": {
            "percentualFederal": tb.nacionalfederal,
            "percentualEstadual": tb.estadual,
            "percentualMunicipal": tb.municipal
          },
          "fonte": "IBPT"
        },
        "icms": {
          "situacaoTributaria": tb.cst,
          "origem": 0,
          "aliquota": tb.al_interestadual,
          "baseCalculo": parseFloat(baseCalculo.toFixed(2)),
          "modalidadeBaseCalculo": 0,
          "percentualReducaoBaseCalculo": tb.red_icms,          
          "baseCalculoST": baseCalculoST,
          "aliquotaST": aliquotaST,
          "modalidadeBaseCalculoST": modalidadeBaseCalculoST,
          "percentualReducaoBaseCalculoST": percentualReducaoBaseCalculoST,
          "percentualMargemValorAdicionadoST": percentualMargemValorAdicionadoST,
          "inscricaoEstadualST": order.inscription_code !== null ? (order.inscription_code).replace(/[^0-9]+/g,'') : null,
          "naoCalcularDifal": true
          /*"baseCalculoUFDestinoDifal": 0,
          "aliquotaUFDestinoDifal": 0, 
          "valorUFDestinoDifal": 0, 
          "valorUFOrigemDifal": 0, 
          "aliquotaInterestadualDifal": 0, 
          "percentualPartilhaInterestadualDifal": 0,
          "baseCalculoFundoCombatePobrezaDifal": 0,
          "percentualFCPDifal": 0, 
          "valorFCPDifal": 0*/
        },
        "pis": {
          "situacaoTributaria": tb.sit_trib_pis_sai,
          "porAliquota": {
            "aliquota": ( tb.sit_trib_pis_sai === "01" ? 1.65 : 0 )
          }
        },
        "cofins": {
          "situacaoTributaria": tb.sit_trib_cofins_sai,
          "porAliquota": {
            "aliquota": ( tb.sit_trib_cofins_sai === "01" ? 7.6 : 0 )
          }
        },
        "ipi": {
          "situacaoTributaria": tb.sit_trib_ipi_sai,
          "porAliquota": {
            "aliquota": ( tb.sit_trib_ipi_sai === "53" ? 0 : "" )
          }
        }
      }      
    }];

    orderItemKitObj.push(...orderItemKit);
  }  

  const result = { orderItemKitObj, weight, totalOrderPrice, orderPriceBrinde};
  return result;
}

async function payloadBuild(order, orderItems) {    
  const fullName = `${order.first_name} ${order.last_name}`;
  const cpfCnpj = order.corporate_document !== null ? order.corporate_document : order.document;
  const tipoPessoa = ( order.state_inscription !== null && order.corporate_document !== null ) ? "J" : "F";
  const sequence = `${(order.hostname).substring(0, 3).toUpperCase()}-${order.sequence}-TESTE10`;
  const phone = formataTelefone(order.phone);
  const weight = (orderItems.weight).toFixed(2);

  const valorOriginal = parseFloat((orderItems.totalOrderPrice + (order.shipping / 100)).toFixed(2));
  const valorParcela = parseFloat(((orderItems.totalOrderPrice - (orderItems.orderPriceBrinde/100)) + (order.shipping/100)).toFixed(2));

  const data = {
    "id": sequence,
    "ambienteEmissao": "Homologacao",
    "tipoOperacao": "Saida",
    "naturezaOperacao": "VENDA MERC SUJEITA ST",
    "finalidade": "Normal",
    "consumidorFinal": tipoPessoa === "F" ? true : false,
    "enviarPorEmail": false, /* true || false */
    "indicadorPresencaConsumidor": "NaoSeAplica",
    "cliente": {
      "tipoPessoa": tipoPessoa,
      "indicadorContribuinteICMS": "NaoContribuinte",
      "nome": fullName,
      "email": order.email,
      "telefone": phone,
      "cpfCnpj": cpfCnpj.replace(/[^0-9]+/g,''),
      "inscricaoMunicipal": null,
      "inscricaoEstadual": order.state_inscription,
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
    "cobranca": {
      "fatura": {
        "numero": "FAT 002456",
        "desconto": parseFloat((orderItems.orderPriceBrinde / 100).toFixed(2)),
        "valorOriginal": valorOriginal
      },
      "parcelas": [{
          "numero": "001",
          "valor": valorParcela, 
          "vencimento": order.authorized_date
      }]
    },
    "itens": orderItems.orderItemKitObj,
    "transporte": {
      "frete": {
        "modalidade": "ContratacaoPorContaDoRemetente"
      },
      "enderecoEntrega": {
        "tipoPessoaDestinatario": tipoPessoa,
        "cpfCnpjDestinatario": cpfCnpj.replace(/[^0-9]+/g,''),
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
        "usarDadosEmitente": false,
        "tipoPessoa": "J",
        "cpfCnpj": (order.cnpj).replace(/[^0-9]+/g,''),
        "nome": order.nome,
        "inscricaoEstadual": null,
        "enderecoCompleto": order.logradouro,
        "uf": order.estado,
        "cidade": order.cidade
      },
      "volume": {
        "quantidade": 1,
        "especie": "VOLUMES",
        "marca": "",
        "numeracao": "1",
        "pesoBruto": parseFloat(weight),
        "pesoLiquido": parseFloat(weight)
      }
    },
    "informacoesAdicionais": ""
  };  

  //return data;
  //return JSON.stringify(data);

  return payloadSend(order.enotas_api_key, order.enotas_id, data);
}

async function payloadSend(apiKey, apiToken, payload) {  
  const axios = require('axios');
  const payloadJson = JSON.stringify(payload);

  //return payloadJson;

  const headers = {
    'Accept': 'application/json',
    'Authorization': `Basic ${apiKey}`,
    'Content-Type': 'application/json'
  }

  try {
    const r = await axios.post(`https://api.enotasgw.com.br/v2/empresas/${apiToken}/nf-e`, payloadJson, {headers});
    const data = r.data;
    return data;
  } catch (err) {
    return err;
  }
}

module.exports = { selectOrders, selectTabelao, dumpError, selectItems, payloadBuild }
