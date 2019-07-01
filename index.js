import promiseFinally from './finally';

// Store setTimeout reference so promise-polyfill will be unaffected by
// other code modifying setTimeout (like sinon.useFakeTimers())
var setTimeoutFunc = setTimeout;

function isArray(x) {
  return Boolean(x && typeof x.length !== 'undefined');
}

function noop() {}

// Polyfill for Function.prototype.bind
function bind(fn, thisArg) {
  return function() {
    fn.apply(thisArg, arguments);
  };
}

/**
 * @constructor
 * @param {Function} fn
 */
function Promise(fn) {
  if (!(this instanceof Promise))
    throw new TypeError('Promises must be constructed via new');
  if (typeof fn !== 'function') throw new TypeError('not a function');
  /** @type {!number} */
  // promise的状态
  /*
    _state: 
    0 : pendind
    1 : fulfilled
    2 : rejected
    3 : fulfilled -> value: promise
   */
  this._state = 0;
  /** @type {!boolean} */
  // 是否已经处理过then回调函数
  this._handled = false;
  /** @type {Promise|undefined} */
  // promise的值
  this._value = undefined;
  /** @type {!Array<!Function>} */
  // 用于收集回调
  this._deferreds = [];

  doResolve(fn, this);
}

// 执行每一个then回调函数
function handle(self, deferred) {
  // 如果resolve的值是一个promise实例对象, 那么该promise的状态取决于resolve的promise的状态
  // p1 = new Promise()
  // p2 = new Promise(function () {
  //  resole(p1)
  // })
  // 如果p1的状态是pending，那么会把p2的回调deferred放入p1的_deferreds中，会等到p1的状态
  // 不是pending的时候才会被调用
  while (self._state === 3) {
    self = self._value;
  }

  // pending状态，收集then回调函数
  if (self._state === 0) {
    self._deferreds.push(deferred);
    return;
  }
  
  self._handled = true;
  // 使用setImmediate或者setTimeout把then回调函数放进任务队列
  Promise._immediateFn(function() {
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;

    // then回调不是函数时，进行相应的resolve或者rejected，即抛给下一个then回调
    // 返回的promise进行处理，
    if (cb === null) {
      (self._state === 1 ? resolve : reject)(deferred.promise, self._value);
      return;
    }
    var ret;
    try {
      ret = cb(self._value);
    } catch (e) {
      reject(deferred.promise, e);
      return;
    }
    // 处理then回调函数的返回值，返回的是一个promise。支持链式调用
    resolve(deferred.promise, ret);
  });
}

// 解析，状态设为fulfilled，执行then回调
// _state: 1 , 正常值， _state: 3； value为promise实例对象
function resolve(self, newValue) {
  // self 为调用Promise的this, 即promise实例对象
  try {
    // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
    if (newValue === self)
      throw new TypeError('A promise cannot be resolved with itself.');
    if (
      newValue &&
      (typeof newValue === 'object' || typeof newValue === 'function')
    ) {
      // 如果resolve(val)的值是一个thenable对象或者函数
      var then = newValue.then;
      if (newValue instanceof Promise) {
        // 如果是一个promise实例对象
        self._state = 3;
        self._value = newValue;
        // 执行then回调函数
        finale(self);
        return;
      } else if (typeof then === 'function') {
        // resolve newValue.then
        doResolve(bind(then, newValue), self);
        return;
      }
    }
    // 普通的value，状态设置fulfilled
    self._state = 1;
    self._value = newValue;
    // 执行then回调函数
    finale(self);
  } catch (e) {
    reject(self, e);
  }
}

// 拒绝：状态rejected：
// _state: 2; 拒绝(rejected)
function reject(self, newValue) {
  self._state = 2;
  self._value = newValue;
  // 执行then回调函数
  finale(self);
}

// 处理then回调: 依次执行then回调函数
function finale(self) {
  // 如果状态是rejected, 并且没有设置then回调
  if (self._state === 2 && self._deferreds.length === 0) {
    Promise._immediateFn(function() {
      if (!self._handled) {
        // 提示可能存在rejected状态的promise未处理
        Promise._unhandledRejectionFn(self._value);
      }
    });
  }

  // 否者依次执行then回调函数
  for (var i = 0, len = self._deferreds.length; i < len; i++) {
    handle(self, self._deferreds[i]);
  }
  self._deferreds = null;
}

/**
 * @constructor
 * 用于构造一个then回调函数的实例对象
 * @params { promise } then返回的promise实例对象
 */
function Handler(onFulfilled, onRejected, promise) {
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise;
}

/**
 * Take a potentially misbehaving resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 */
// 主要作用：传进resolve，reject执行Promise同步函数
function doResolve(fn, self) {
  // self， 调用Promise的this
  
  // 用来保证一个promise实例，同一时刻只能进行一次resolve或者reject
  var done = false;
  // 同步执行cb, 传进resolve， reject函数
  try {
    fn(
      function(value) {
        if (done) return;
        done = true;
        resolve(self, value);
      },
      function(reason) {
        if (done) return;
        done = true;
        reject(self, reason);
      }
    );
  } catch (ex) {
    if (done) return;
    done = true;
    reject(self, ex);
  }
}

// catch: 绑定rejected状态的回调函数，本质是使用then,只传入onRejected
Promise.prototype['catch'] = function(onRejected) {
  return this.then(null, onRejected);
};

// then：用于绑定异步回调
Promise.prototype.then = function(onFulfilled, onRejected) {
  // @ts-ignore
  // then返回的一个promise实例对象
  var prom = new this.constructor(noop);

  // 状态pending时，收集回调，否者在下一次事件循环中执行回调
  handle(this, new Handler(onFulfilled, onRejected, prom));
  return prom;
};

// finally： 本质：不管状态是resolve还是rejected，使用then，在onResolved和onRejected中都执行
// finally的回调函数
Promise.prototype['finally'] = promiseFinally;

// @params {arr} array <promise|object|function>
Promise.all = function(arr) {
  // Promise.all返回的是一个promise实例对象
  return new Promise(function(resolve, reject) {
    if (!isArray(arr)) {
      return reject(new TypeError('Promise.all accepts an array'));
    }

    var args = Array.prototype.slice.call(arr);
    if (args.length === 0) return resolve([]);
    // 设置标记，即主要resolve的promise的个数为传进的数组arr的个数，才进行resolve。
    // 然后一旦有其中一个状态为rejected，则直接就rejected。
    var remaining = args.length;

    function res(i, val) {
      try {
        // 如果是then对象
        if (val && (typeof val === 'object' || typeof val === 'function')) {
          var then = val.then;
          if (typeof then === 'function') {
            then.call(
              val,
              // 递归处理，因为可能在then中resolve的值还是一个then对象
              function(val) {
                res(i, val);
              },
              reject
            );
            return;
          }
        }

        args[i] = val;
        if (--remaining === 0) {
          resolve(args);
        }
      } catch (ex) {
        reject(ex);
      }
    }

    // 处理arr中的每一项
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

// Promise.resolve返回的是一个promise对象
Promise.resolve = function(value) {
  // 如果Promise.resolve的值已经是一个promise实例对象则直接返回
  if (value && typeof value === 'object' && value.constructor === Promise) {
    return value;
  }

  // 否者创建一个Promise实例对象并且resolve该值
  return new Promise(function(resolve) {
    resolve(value);
  });
};

// Promise.reject 直接创建返回一个进行reject的promise实例对象
Promise.reject = function(value) {
  return new Promise(function(resolve, reject) {
    reject(value);
  });
};

// race: 将多个包装成一个promise，该promise的值为率先改变的promise的值
Promise.race = function(arr) {
  return new Promise(function(resolve, reject) {
    if (!isArray(arr)) {
      return reject(new TypeError('Promise.race accepts an array'));
    }

    for (var i = 0, len = arr.length; i < len; i++) {
      // 那个arr[i] promise率先改变，即会调用resolve或者reject，则race返回的Promise
      // 的then回调函数的值即为该promise的resolve/reject的值
      Promise.resolve(arr[i]).then(resolve, reject);
    }
  });
};

// Use polyfill for setImmediate for performance gains
// 优先使用，保证较好的性能。如环境不支持setImmediate，则使用setTimeout
Promise._immediateFn =
  // @ts-ignore
  (typeof setImmediate === 'function' &&
    function(fn) {
      // @ts-ignore
      setImmediate(fn);
    }) ||
  function(fn) {
    setTimeoutFunc(fn, 0);
  };

Promise._unhandledRejectionFn = function _unhandledRejectionFn(err) {
  if (typeof console !== 'undefined' && console) {
    console.warn('Possible Unhandled Promise Rejection:', err); // eslint-disable-line no-console
  }
};

export default Promise;
