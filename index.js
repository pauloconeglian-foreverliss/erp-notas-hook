const util = require('util');
const NS_PER_SEC = 1e+9;
const start = process.hrtime();
const cm = require('./common');

(async () => {
  const orders = await cm.selectOrders();
  for ( const [index, order] of orders.entries( )) {
    const items = await cm.selectItems(order);
    const payload = await cm.payloadBuild(order, items);

    console.log('\n************************************************');
    console.log(`------------------| PEDIDO ${index+1} |------------------`);
    console.log('************************************************\n');
    console.log(util.inspect(payload, false, null, true));
  }
  
  console.log(`\n--------------------------------------------------\nš Benchmark levou ${start[1] / NS_PER_SEC} segundos`);
})();