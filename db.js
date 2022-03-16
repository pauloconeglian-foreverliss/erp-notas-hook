require('dotenv').config();

async function connect() {
  if (global.connection){
    return global.connection;
  }
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
  global.connection = pool.connect();
  return global.connection;
};

function dumpError(err) {
  if (typeof err === 'object') {
    if (err.message) {
      console.log('\nMessage: ' + err.message)
    }
    if (err.stack) {
      console.log('\nStacktrace:')
      console.log('====================')
      console.log(err.stack);
    }
  } else {
    console.log('dumpError :: argument is not an object');
  }
}
  
async function selectOrders() {
  const client = await connect();
  const res = await client.query(`
    SELECT
      od.authorized_date, od.sequence, od.order_total, od.item_total, od.discount, od.shipping, od.delivery_company, od.hostname, od.invoiced_date,
      cl.first_name, cl.last_name, cl.email, cl.document_type, cl.document, cl.home_phone, cl.is_corporate, cl.corporate_name, cl.corporate_doc, cl.trade_name, cl.state_registration,
      ad.receiver_name, ad.postal_code, ad.street, ad.number, ad.neighborhood, ad.city, ad.state, ad.country, ad.complement,
      tr.nome, tr.cnpj, tr.logradouro, TRIM(tr.estado), tr.cidade
    FROM erp.order AS od
    JOIN erp.client AS cl ON od.user_id = cl.user_id
    JOIN erp.address AS ad ON ad.address_id = od.address_id
    JOIN erp.transportadoras AS tr ON tr.frete = od.delivery_company
    WHERE 
      od.status='ready-for-handling'
      AND od.invoiced_date IS NULL
    ORDER BY od.authorized_date ASC
  `);

  return orders = res.rows;
}

async function selectTabelao(order, item) {
  try {    
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

    // console.log(`
    //     WHERE ncm_id='${item.ncm_id}'
    //     AND sigla='${state}' 
    //     AND sigla_origem='${sigla_origem}'
    //     AND tipo_produto='${item.class_prod}'
    //     AND contribuinte='${contribuinte}'
    //     AND cest_code='${item.cest_code}'
    //     AND perfil_imposto='${item.perfil_imposto}'
    //     AND reference_id='${item.reference_id}'
    // `);
    
    const res = await client.query(`
      SELECT *
      FROM erp.tabelao_test4 AS tb
      JOIN erp.icms AS ic ON ic.uf = tb.sigla
      WHERE tb.ncm_id='${item.ncm_id}'
        AND tb.sigla='${state}' 
        AND tb.sigla_origem='${sigla_origem}'
        AND tb.tipo_produto='${item.class_prod}'
        AND tb.contribuinte='${contribuinte}'
        AND tb.cest_code='${item.cest_code}'
        AND tb.perfil_imposto='${item.perfil_imposto}'
        AND tb.reference_id='${item.reference_id}'
    `);

    return tabelao = res.rows;
  } catch(err) {    
    dumpError(err);
  }
}

/*----------------------------------------------*/
/*------------------| KITS |---------------------/
/*----------------------------------------------*/

// async function teste() {
//   const client = await connect();
//   await client.query(`
//     SELECT * FROM erp.product LIMIT 1
//   `)
//   .then(result => result)
//   .catch(e => console.log(e.stack))
//   .then((result) => {
//     return result.rows
//     client.end()
//   })    
// }


async function selectOrderKitItems(order) {  
  try {
    const client = await connect();    
    const res = await client.query(`      
      SELECT *, pr.perfil_imposto AS perfil_imposto_id, tf.valor_total_pedido, (it.quantity * it.price) AS valor_total_uni
      FROM erp.order_items AS it
      CROSS JOIN (
        SELECT SUM(quantity * price) AS valor_total_pedido
        FROM erp.order_items
        WHERE sequence = '${order.sequence}'
      ) AS tf
      JOIN erp.product AS pr ON pr.reference_id = it.ref_id
      JOIN erp.cest AS ct ON ct.cest_id = pr.cest_id
      JOIN erp.perfil_imposto AS pi ON pi.perfil_imposto = pr.perfil_imposto
      WHERE
        it.sequence = '${order.sequence}'
        AND pr.is_kit = true
    `);

    const orderItems = res.rows;
    const result = [];    
    
    if ( orderItems.length > 0 ) {
      for (const item of orderItems) {      
        const itemKit = await setOrderKitItems(order, item);
        console.log(itemKit);
      }      
    }
  } catch (err) {
    dumpError(err);
  }
}

async function setOrderKitItems(order, item) {
  try {
    const client = await connect();
    const res = await client.query(`
      SELECT *, pk.quantity AS kit_quantity
      FROM erp.vitrine AS vt
      CROSS JOIN (
        SELECT SUM(tp.preco) AS total_preco_items_kit
        FROM erp.vitrine AS vt
        JOIN erp.product_kit AS pk ON pk.kit_product_id = vt.product_id
        JOIN erp.product AS pr ON pr.product_id = pk.product_id
        JOIN erp.preco AS tp ON tp.reference_id = pr.reference_id AND tp.tabela = vt.table_price_id
        WHERE
          vt.hostname = '${order.hostname}'
          AND vt.sku_id = '${item.id}'
      ) AS ttp
      JOIN erp.product_kit AS pk ON pk.kit_product_id = vt.product_id
      JOIN erp.product AS pr ON pr.product_id = pk.product_id
      JOIN erp.preco AS tp ON tp.reference_id = pr.reference_id AND tp.tabela = vt.table_price_id
      JOIN erp.cest AS ct ON ct.cest_id = pr.cest_id
      JOIN erp.perfil_imposto AS pi ON pi.perfil_imposto = pr.perfil_imposto      
      WHERE
        vt.hostname = '${order.hostname}'
        AND vt.sku_id = '${item.id}'
    `);

    const orderItemsKits = res.rows;        

    const orderItem = {
      'price_order_items': item.price,
      'selling_price_order_items': item.selling_price,
      'quantity_order_price': item.quantity,
      'shipping_order_price': item.shipping
    }

    return await setOrderItemsKitJson(order, orderItemsKits, orderItem);
  } catch (err) {
    dumpError(err);
  }
}

async function setOrderItemsKitJson(order, itemsKit, orderItem) {
  const itemsKitLength = itemsKit.length;  
  let orderItemKitObj = [];
  
  for ( item of itemsKit ) {
    const is_brinde = item.selling_price == 0 ? true : false;    
    const brinde = is_brinde ? " (BRINDE)" : "";
    //let orderWeight = (item.weight * item.quantity);
    let cfop = null;
    let frete_produto_total = 0;
    let baseCalculo = 0;
    let baseCalculoST = 0;
    let aliquotaST = 0;
    let modalidadeBaseCalculoST = 0; 
    let percentualReducaoBaseCalculoST = 0;
    let percentualMargemValorAdicionadoST = 0;
    let averagePriceEachKitProduct = 0;

    // Calculo rateio preço produtos que compõe o kit
    /*
      Para referência deste calculo, consultar:
      https://docs.google.com/spreadsheets/d/1EonErQbGWh6ElbiWgD7nK-iJGtOYNPRCv2j9oK9VYXk/edit#gid=1203929356
    */
    if ( itemsKitLength > 1 ) {
      //KITS
      const orderItemQuantity = orderItem.quantity_order_price;
      const kitQuantity = item.quantity;
      const productPriceUni = item.preco;
      const totalQuantity = ( orderItemQuantity * kitQuantity );
      const totalPriceItemsKit = ( item.total_preco_items_kit * totalQuantity );
      const kitPrice = ( orderItem.price_order_items * totalQuantity);
      const totalPrice = ( totalQuantity * productPriceUni  );
      const kitPercentage = ( totalPrice / totalPriceItemsKit );
      averagePriceEachKitProduct = parseFloat(( ( kitPercentage * kitPrice ) / 100 ).toFixed(2));      
    } else {
      //COMBOS (kits com os mesmos produtos)
      const orderItemQuantity = orderItem.quantity_order_price;
      const kitQuantity = item.quantity;
      const kitPrice = orderItem.price_order_items;
      const totalQuantity = ( orderItemQuantity * kitQuantity );      
      averagePriceEachKitProduct = parseFloat( ((( kitPrice * orderItemQuantity ) / totalQuantity) / 100).toFixed(2) );      
    }    
     
    const tabela = await selectTabelao(order, item);
    const tb = tabela[0];
    let frete_final_produto, frete_rateio_produto, frete = null;  
    
    /* Calculo Frete produto individual */
    frete_produto_total = item.frete_produto_total;
    frete_rateio_produto = ( item.frete_produto_uni / frete_produto_total );
    frete_final_produto = ( item.shipping * frete_rateio_produto );
    baseCalculo = (( item.price * item.quantity ) + frete_final_produto );
    frete = frete_final_produto;

    /* percentualMargemValorAdicionadoST */
    if ( tb.subst_icms_ajust !== null) {
      percentualMargemValorAdicionadoST = tb.subst_icms_ajust;
    } else if ( tb.subst_icms !== null ) {
      percentualMargemValorAdicionadoST = tb.subst_icms;
    }

    /* Verificação CFOP */
    if ( order.state == 'SP' || order.state == 'MG' ) {
      cfop = is_brinde ? "5910" : tb.cfop_estadual;
    } else {
      cfop = is_brinde ? "6910" : tb.cfop_interestadual;
    }

    /* Campos Pessoa Jurídica / CNPJ+IE */
    if ( tb.contribuinte === true ) {
      baseCalculoST = ((( baseCalculo * percentualMargemValorAdicionadoST ) + baseCalculo ) / 100).toFixed(2);
      aliquotaST = tb.al_icmss;
      modalidadeBaseCalculoST = 4;
      percentualReducaoBaseCalculoST = 0;
      percentualMargemValorAdicionadoST = percentualMargemValorAdicionadoST;
    }
    
    const orderItemKit = {  
      "cfop": cfop.toString(),
      "codigo": item.reference_id,
      "descricao": `${(item.name).toUpperCase()}${brinde}`,
      "sku": null,
      "ncm": (tb.ncm_id).toString(),
      "cest": tb.cest_code,
      "quantidade": item.quantity,
      "unidadeMedida": "UN",
      "valorUnitario": averagePriceEachKitProduct,
      "frete": ( frete / 100 ).toFixed(2),
      "impostos": {
        "percentualAproximadoTributos": {
          "simplificado": {
            "percentual": 0
          },          
          "fonte": "IBPT"
        },
        "icms": {
          "situacaoTributaria": tb.cst,
          "origem": 0,
          "aliquota": tb.al_interestadual,
          "baseCalculo": ( baseCalculo / 100 ).toFixed(2),
          "modalidadeBaseCalculo": 0,
          "percentualReducaoBaseCalculo": tb.red_icms,          
          "baseCalculoST": baseCalculoST,
          "aliquotaST": aliquotaST,
          "modalidadeBaseCalculoST": modalidadeBaseCalculoST,
          "percentualReducaoBaseCalculoST": percentualReducaoBaseCalculoST,
          "percentualMargemValorAdicionadoST": percentualMargemValorAdicionadoST,
          "naoCalcularDifal": false /* verificar esse campo */
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
            "aliquota": ( tb.sit_trib_ipi_sai === "53" ? 0 : "")
          }
        }
      },
      "informacoesAdicionais": `SIGLA ORIGEM: ${tb.sigla_origem}`
    };

    orderItemKitObj.push(orderItemKit);
  }  

  return orderItemKitObj;
}

/*----------------------------------------------*/
/*-------------| ITEMS NÃO KITS |---------------*/
/*----------------------------------------------*/

async function setOrderItems(order, itemsNoKit) {
  //console.log('weewewe', itemsNoKit);
}

module.exports = { selectOrders, selectOrderKitItems }
