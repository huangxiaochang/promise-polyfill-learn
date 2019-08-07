const PROMISE_STATUS = {
	pending: 0, // 等待状态
	fulfilled: 1, // 已经resolve的状态
	rejected: 2, // 已经reject状态
	promiseFulfilled: 3, // resolve的值是一个promise
}


function Promise (fn) {
	if (!this instanceof Promise) {
		throw new TypeError("Promise must be constructed via new")
	}

	if (typeof fn !== 'function') {
		throw new TypeError("not a function")
	}

	this._value = undefined
	this._status = PROMISE_STATUS.pending
	this._deferredCbs = [] // then回调函数

	// 处理创建promise实例时的参数函数
	doResolve(fn, this)
}

function doResolve (fn, self) {
	// 防止fn中再次调用fn,造成在一个实例化promise中多次执行resolve或者reject
	let done = false
	try {
		// 为了确保内部的resolve和reject函数的this为promise，传进一个包裹函数
		fn(function rs (val) {
			if (done) { return }
			done = true
			resolve(val, self)
		}, function rj (err) {
			if (done) { return }
			done = true
			reject(err, self)
		})
	} catch (e) {
		if (done) { return }
		done = true
		reject(e, self)
	}
}

// 状态改变后，执行每一个回调函数的处理函数
function handle(deferred, self) {
	// 如果该promise(p1) resolve的值是一个promise(p2),则p1的状态和最终resolve的值，由
	// p2决定
	while(self._status === PROMISE_STATUS.promiseFulfilled) {
		self = self._value
	}

	if (self._status === PROMISE_STATUS.pending) {
		// 如果该promise(p1) resolve的是另一个promise(p2),加入的回调队列是p2的回调队列，
		// 不管是在p1的状态改变之前或者改变之后添加的回调，因为调用的都是该handle函数。
		// 所以p1的回调函数，会在p2的状态改变之后被执行
		self._deferredCbs.push(deferred)
		return
	}

	// 否者，在下一次事件循环中执行回调
	setTimeout(function () {
		// 根据状态来获取相应类型的回调
		let cb = self._status === PROMISE_STATUS.fulfilled ? deferred.onFulfilled : deferred.onRejected

		// 如果then没有回调注册相应的回调函数,则要把该promise的状态后传到then的回调函数返回的promise
		if (!cb) {
			(self._status === PROMISE_STATUS.fulfilled ? resolve : reject)(self._value, deferred.promise)
			return
		}

		let ret 
		try {
			// 把该promise的值作为参数执行then回调函数
			ret = cb(self._value)
		} catch (e) {
			// 如果在执行then回调函数的时候，发生错误，则把then回调返回promise状态改成reject
			reject(e, deferred.promise)
			return
		}
		// 进行then回调返回的promise对象进行resolve
		resolve(ret, deferred.promise)
	}, 0)

}

// 状态改变后的处理函数
function doFinale (self) {
	// 如果发生reject并且没有相应的处理函数，则进行提示
	if (self._status === PROMISE_STATUS.rejected && self._deferredCbs.length === 0) {
		setTimeout(function () {
			if (typeof console !== 'undefined' && console) {
				console.warn("Possible promise unhandled with rejected")
			}
		}, 0)
	}

	for(let i = 0 ; i < self._deferredCbs.length; i++) {
		handle(self._deferredCbs[i], self)
	}
	self._deferredCbs = null
}

// 之所以不把resolve、reject部署到Promise的原型上或者静态方法上，是因为防止防止被覆盖
function resolve (value, self) {
	// 因为resole的值可能是thenable对象，执行thenable时可能出错，所以应该或者错误信息
	try {
		if (value === self) {
			throw new Error("a promise cannot be resolved with itself")
		}
		// 如果resolve的是一个函数或者thenable对象
		if (
			value &&
			typeof value === 'object' || typeof value === 'function' 
		) {
			const then = value.then

			// 如果resolve的是一个promise, 则会特别处理，应该该promise的状态会由resolve的promise决定
			if (value instanceof Promise) {
				self._status = PROMISE_STATUS.promiseFulfilled
				self._value = value
				doFinale(self)
			} else if (typeof then === 'function') {
				// 如果是一个thenable对象,执行then函数
				doResolve(then.bind(value), self)
				return
			}
		}

		// resolve的是一个普通的值
		self._status = PROMISE_STATUS.fulfilled
		self._value = value
		// 执行回调
		doFinale(self)
	} catch (e) {
		reject(e, self)
	}
}

function reject (error, self) {
	self._status = PROMISE_STATUS.rejected
	self._value = error
	doFinale(self)
}

// 注册promise状态改变后的回调函数，then函数返回的是一个promise实例对象
Promise.prototype.then = function(onFulfilled, onRejected) {
	let Prom = new this.constructor(function() {})
	const deferred = {
		onFulfilled: typeof onFulfilled === 'function' ? onFulfilled : null,
		onRejected: typeof onRejected === 'function' ? onRejected : null
		promise: Prom
	}
	// 根据状态来处理回调函数
	handle(deferred, this)
	return Prom
}

Promise.prototype.catch = function (onRejected) {
	return this.then(null, onRejected)
}

// finally总是返回原来的值
Promise.prototype.finally = function (onFinally)  {
	const Prom = this.constructor

	return this.then(function (value) {
		return Prom.resolve(onFulfilled()).then(function () {
			// 返回原来的值
			return value
		})
	}, function (error) {
		return Prom.resolve(onFulfilled()).then(function () {
			// 返回原来的值
			return Prom.reject(error)
		})
	})
}

Promise.resolve = function (value) {
	if (
		value &&
		typeof value === 'object' && value.constructor instanceof Promise
	) {
		retrun value
	}
	return new Promise(function (resolve, reject) {
		resolve(value)
	})
}

Promise.reject = function (error) {
	return new Promise(function (resolve, reject) {
		reject(error)
	})
}

function isArrayLike (obj) {
	return obj && (typeof obj.length !== 'undefined')
}

// arr：必须是具有Iterator的对象, Promise.alll返回的也是一个promise
Promise.all = function (arr) {
	return new Promise(function(resolve, reject) {
		// 参数只能是具有Iterator接口的对象
		if (!isArrayLike(arr)) {
			return reject(new TypeError("Promise.all accepts an array"))
		}

		let ags = Array.prototype.slice.call(arr)

		if (args.length === 0) { retrun resolve([]) }

		let remaining = args.length

		function handlePromise (val, i) {
			try {
				// 如果是thenable对象，执行then
				if (
					val &&
					(typeof val === 'object' || typeof val === 'function')
				) {
					const then = val.then
					if (typeof then === 'function') {
						// 执行then添加回调，传进Promise.all的reject，这样，单某个promise变成reject后，
						// Promise.all的状态就会变成reject。然后对于pormise变成resolve时，再对resolve的值
						// 进行循环处理，如果是一般的值，则等待resolve的个数减1，直到所有的promise变成
						// resolve，Promise.all的状态才变成resolve
						then.call(
							val,
							function (value) {
								handlePromise(value, i)
							},
							reject
						)
						return
					}
				}
				
				// 如果不是promise或者thenable对象，则直接resolve该项的值
				ags[i] = val
				if (--remaining === 0) {
					resolve(args)
				}
			} catch (e) {
				reject(e)
			}
		}

		for (let i = 0 ; i < args.length; i++) {
			handlePromise(args[i], i)
		}

	})
}


Promise.race = function (arr) {
	return new Promise(function(resolve, reject) {
		if (!isArrayLike(arr)) {
			return reject(new TypeError("Promise.race accepts an array"))
		}

		const args = Array.prototype.slice.call(arr)

		// function handleRace (val, i) {
		// 	try {
		// 		if (
		// 			val &&
		// 			(typeof val === 'object' || typeof val === 'function')
		// 		) {	
		// 			const then = val.then
		// 			if (typeof then === 'function') {
		// 				then.call(
		// 					val,
		// 					// 某个promise状态reject时，race的状态也立即resolve
		// 					resolve,
		// 					// 某个promise状态reject时， race的状态立即reject
		// 					reject
		// 				)
		// 			}
		// 		}
		// 		// 某一个promise状态改变resolve时，Promise.race的状态也会立即变成resolve
		// 		resolve(val)
		// 	} catch(e) {
		// 		reject(e)
		// 	}
		// }

		for(let i = 0 ; i < args.length; i++) {
			// handleRace(val, i)
			Promise.resolve(args[i]).then(resolve, reject)
		}

	})
}

Promise.try = function (fn) {
	return new Promise(function(resolve, reject) {
		try {
			resolve(fn())
		} catch (e) {
			reject(e)
		}
	})
}


export default Promise

