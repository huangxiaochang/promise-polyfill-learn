/**
 * @this {Promise}
 * // finally总是返回原来的值
 */
function finallyConstructor(callback) {
  var constructor = this.constructor;
  return this.then(
    function(value) {
      // @ts-ignore
      return constructor.resolve(callback()).then(function() {
        // 返回原来的值
        return value;
      });
    },
    function(reason) {
      // @ts-ignore
      return constructor.resolve(callback()).then(function() {
        // 返回原来的值
        // @ts-ignore
        return constructor.reject(reason);
      });
    }
  );
}

// export default finallyConstructor;
module.exports = finallyConstructor