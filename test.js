// import Promise as Prom from './index.js'
const Promise = require('./index.js')

console.log('start...')

// setTimeout(function () {
// 	console.log(1111)
// }, 0)

// // 应该在本轮事件循环结束之后别执行，而不是下一次事件循环开始时执行
// Promise.resolve().then(function() {
// 	console.log(2222)
// })

Promise.try(function () {
	console.log(1111)
	a
	return 222
}).then(function (val) {
	console.log(val)
}).catch(function (e) {
	console.log(222)
	// console.warn(e)
})

// 原生的Promise输出的结果是2222,1111
// 而Promise-polyfill输出的结果是1111,2222

console.log('end...')