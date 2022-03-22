const util = require('util');
const NS_PER_SEC = 1e+9;
const start = process.hrtime();
const kits = require('./kits');
const cm = require('./common');

(async () => {
  const orders = await cm.selectOrders();
  for ( const [index, order] of orders.entries( )) {
    const items = await cm.selectItems(order);
    console.log('\n************************************************');
    console.log(`------------------| PEDIDO ${index+1} |------------------`);
    console.log('************************************************\n');
    console.log(util.inspect(items, false, null, true));
  }
  
  console.log(`Benchmark levou ${start[1] / NS_PER_SEC} segundos`);

  // const orders = await cm.selectOrders();
  // for (const [index, order] of orders.entries()) {
  //   const orderItemsKits = await kits.selectOrderKitItems(order);

  //   console.log('\n************************************************');
  //   console.log(`------------------| PEDIDO ${index+1} |------------------`);
  //   console.log('************************************************\n');
  //   console.log(util.inspect(orderItemsKits, false, null, true));
  // }
  // console.log(`Benchmark levou ${start[1] / NS_PER_SEC} segundos`);
})();