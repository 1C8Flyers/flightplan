export default function batch(action, { size = 1, wait = Infinity }) {
  let timeout = null;
  let current = [];

  return params => {
    const batch = current;

    const send = async () => {
      Promise.resolve(action(batch.map(it => it.params))).then(results => {
        results.forEach((result, i) => {
          batch[i].resolve(result);
        });
      });
    };

    return new Promise((resolve, reject) => {
      batch.push({ resolve, params, reject });
      if (batch.length === size) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        send();
        current = [];
      } else if (!timeout && wait !== Infinity) {
        timeout = setTimeout(function () {
          // check if batch already sent
          if (current === batch) {
            current = [];
            clearTimeout(timeout);
            timeout = null;
            send();
          }
        }, wait);
      }
    });
  };
}
