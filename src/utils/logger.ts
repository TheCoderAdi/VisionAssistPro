const enabled = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export const debug = (...args: any[]) => {
  if (enabled && console?.debug) console.debug(...args);
};

export const log = (...args: any[]) => {
  if (enabled && console?.log) console.log(...args);
};

export const warn = (...args: any[]) => {
  if (enabled && console?.warn) console.warn(...args);
};

export const error = (...args: any[]) => {
  if (enabled && console?.error) console.error(...args);
};

export default { debug, log, warn, error };
