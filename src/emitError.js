import { isNode } from './env';

const UNHANDLED_REJECTION = 'unhandledRejection';

export default function () {
    /*global process, self, CustomEvent*/
    if (isNode && typeof process.emit === 'function') {
        // Returning falsy here means to call the default reportRejection API.
        // This is safe even in browserify since process.emit always returns
        // falsy in browserify:
        // https://github.com/defunctzombie/node-process/blob/master/browser.js#L40-L46
        return function (type, error) {
            return type === UNHANDLED_REJECTION
                ? process.emit(type, error.value, error)
                : process.emit(type, error);
        };
    } else if (typeof self !== 'undefined' && typeof CustomEvent === 'function') {
        return (function (noop, self, CustomEvent) {
            let hasCustomEvent = false;
            try {
                hasCustomEvent = new CustomEvent(UNHANDLED_REJECTION) instanceof CustomEvent;
            } catch (e) {}

            return !hasCustomEvent ? noop : function (type, error) {
                let ev = new CustomEvent(type, {
                    detail: {
                        reason: error.value,
                        promise: error
                    },
                    bubbles: false,
                    cancelable: true
                });

                return !self.dispatchEvent(ev);
            };
        }(noop, self, CustomEvent));
    }

    return noop;
}

function noop() {}