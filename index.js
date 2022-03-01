const util = require('util');

(async () => {
  const db = require('./db');
    const orders = await db.selectOrders();                
    
    for (const [index, order] of orders.entries()) {
      const sequencePK = order.sequence;
      const orderItems = await db.selectOrderItems(order, sequencePK);

      //console.log(orderItems);
      // const payloadResponse = await db.payloadSend(order, orderItems);
      

      //console.log(payloadResponse);

      // console.log('\n************************************************');
      // console.log(`------------------| PEDIDO ${index+1} |------------------`);
      // console.log('************************************************\n');
      // console.log(util.inspect(payloadResponse, false, null, true));
    }
})();

/** email Eduarda Couto: duda_rasmus@hotmail.com */