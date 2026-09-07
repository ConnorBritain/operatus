'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fits}=require('../tools/run-layout-evidence.cjs');
test('a fitting document cannot hide an overflowing completed-run panel',()=>{
 const layout={document:{clientWidth:1440,scrollWidth:1440},area:{clientWidth:986,scrollWidth:1134},detail:{clientWidth:958,scrollWidth:1120}};
 assert.equal(fits(layout),false);
 assert.equal(fits({...layout,area:{clientWidth:986,scrollWidth:986},detail:{clientWidth:958,scrollWidth:958}}),true);
});
