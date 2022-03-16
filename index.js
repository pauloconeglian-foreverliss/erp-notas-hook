const util = require('util');

(async () => {
  const db = require('./db');
    // const teste = await db.teste();
    // console.log(teste);
    const orders = await db.selectOrders();
    for (const [index, order] of orders.entries()) {            
      
      const orderItemsKits = await db.selectOrderKitItems(order);      
      
      console.log('\n************************************************');
      console.log(`------------------| PEDIDO ${index+1} |------------------`);
      console.log('************************************************\n');
      console.log(util.inspect(orderItemsKits, false, null, true));
    }
})();