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

/* TESTE PERFORMANCE */

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
        CASE WHEN pr.is_kit = TRUE THEN pi2.perfil_imposto ELSE pi.perfil_imposto END AS perfil_imposto,
        CASE WHEN pr.is_kit = TRUE THEN pr2.reference_id ELSE it.ref_id END AS reference_id,
        CASE WHEN pr.is_kit = TRUE THEN ( it.quantity * pk.quantity ) ELSE it.quantity END AS quantity,
        CASE WHEN pr.is_kit = TRUE THEN UPPER(pr2.name) ELSE UPPER(it.name) END AS name,
        CASE WHEN pr.is_kit = TRUE THEN vt2.sku_id ELSE it.id END AS sku_id,
        CASE WHEN pr.is_kit = TRUE THEN pc.preco ELSE it.selling_price END AS price,
        CASE WHEN pr.is_kit = TRUE THEN pr2.product_id ELSE pr.product_id END AS product_id,        
        it.price AS order_price, it.shipping, it.selling_price, it.quantity AS order_item_quantity, ( it.price - it.selling_price ) AS discount,
        pr.is_kit, pr.weight, 
        vt.sku_id,
        pk.kit_product_id
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

async function setOrderItemsKitJson(order, orderItems) {
  
  let orderItemKitObj = [];  
  for ( item of orderItems ) {
    const skuProductKit = item.sku_id;
    const is_brinde = item.selling_price == 0 ? true : false;
    const brinde = is_brinde ? " (BRINDE)" : "";    
    //let orderWeight = (item.weight * item.quantity);
    let itemsKitLength = 0;        
    let orderProductQuantity = 0;    
    let cfop = null;
    let frete_produto_total = 0;
    let baseCalculo = 0;
    let baseCalculoST = 0;
    let aliquotaST = 0;
    let modalidadeBaseCalculoST = 0; 
    let percentualReducaoBaseCalculoST = 0;
    let percentualMargemValorAdicionadoST = 0;
    let frete_final_produto, frete_rateio_produto, frete = null; 
    let price = item.price;

    if ( item.is_kit === true ) {
      itemsKitLength = await setItemsKitQuantity(order, item.kit_product_id);
      totalPriceItemsKit = await setItemsKitTotalPrice(order, item.kit_product_id);          

      
      if ( itemsKitLength > 1 ) {        
        // KITS
        /* O rateio de desconto para os items do kit acontece aqui */
        let discount = item.discount > 0 ? item.discount : 0;
        let discountAverage = (discount / itemsKitLength);
        /* // */

        let iq = itemQuantity = item.quantity;
        let opp = orderProductPrice = item.order_price;
        let opq = orderProductQuantity = item.order_item_quantity;
        let oppt = orderProductPriceTotal = ( opp * opq );
        let pkip = productsKitItemsPrice = ( item.price * iq );
        let pkipt = productsKitItemsPriceTotal = ( totalPriceItemsKit * iq );
        let pik = percentageItemsKit = ( pkip / pkipt );
        price = ((( pik * oppt ) / iq ) - discountAverage);
      } else {
        // COMBOS (kits com os mesmos produtos)
        /* O rateio de desconto para todos os itens do combo acontecem aqui */
        let discount = item.discount > 0 ? item.discount : 0;
        let discountAverage = (discount / item.quantity);
        /* // */

        let iq = itemQuantity = item.quantity;
        let opp = orderProductPrice = item.order_price;
        let opq = orderProductQuantity = item.order_item_quantity;
        let oppt = orderProductPriceTotal = ( opp * opq );
        price = (( oppt / iq ) - discountAverage );
      }            
    }
        
    // frete_produto_total = ( order. );
    frete_rateio_produto = ( item.frete_produto_uni / frete_produto_total );
    frete_final_produto = ( item.shipping * frete_rateio_produto );
    baseCalculo = (( item.price * item.quantity ) + frete_final_produto );
    frete = frete_final_produto;

    const tabela = await selectTabelao(order, item);
    const tb = tabela[0];

    /* percentualMargemValorAdicionadoST */
    if ( tb.subst_icms_ajust !== null) {
      percentualMargemValorAdicionadoST = tb.subst_icms_ajust;
    } else if ( tb.subst_icms !== null ) {
      percentualMargemValorAdicionadoST = tb.subst_icms;
    }

    /* Verificação CFOP - REFAZER!!!!!!!!!!!!!!!!!!!!!!!!! */
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
    
    const orderItemKit = [{
      "cfop": cfop.toString(),
      "codigo": item.reference_id,
      "descricao": `${(item.name).toUpperCase()}${brinde}`,
      "sku": skuProductKit,
      "ncm": (tb.ncm_id).toString(),
      "cest": tb.cest_code,
      "quantidade": item.quantity,
      "unidadeMedida": "UN",
      "valorUnitario":  parseFloat( price / 100 ).toFixed(2),
      "frete": ( frete / 100 ).toFixed(2),
      "impostos": {
        "percentualAproximadoTributos": {
          "detalhado": {
            "percentualFederal": 0.00,
            "percentualEstadual": 0.00,
            "percentualMunicipal": 0.00
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
    }];

    orderItemKitObj.push(...orderItemKit);
  }  

  return orderItemKitObj;
}

/* TESTE PERFORMANCE */

async function selectOrders() {
  try {
    const client = await db.connect();
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

    /* Verifica se cliente é contibuinte */
    if ( order.corporate_doc !== null && order.state_registration !== null ) {
      contribuinte = true;
    }
    
    /* Define sigla_origem */
    sigla_origem = ( order.state === 'SP') ? 'SP' : 'MG';

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

module.exports = { selectOrders, selectTabelao, dumpError, selectItems }
