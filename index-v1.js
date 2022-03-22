const util = require('util');

(async () => {
  const db = require('./db-v1');
    const orders = await db.selectOrders();                
    
    for (const [index, order] of orders.entries()) {
      const hostname = order.hostname;
      const sequencePK = order.sequence;
      const orderItems = await db.selectOrderItems(hostname, sequencePK);
      const payloadResponse = await db.payloadSend(order, orderItems);      

      // console.log('\n************************************************');
      // console.log(`------------------| PEDIDO ${index+1} |------------------`);
      // console.log('************************************************\n');
      // console.log(util.inspect(payloadResponse, false, null, true));
    }
})();

/** email Eduarda Couto: duda_rasmus@hotmail.com */