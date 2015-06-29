'use strict';
import Scheduler from './Scheduler';
import async from './async';
import createHandlers from './handlers';
import registerRejection from './registerRejection';
import { PENDING, RESOLVED, FULFILLED, REJECTED, SETTLED, HANDLED } from './state';

let taskQueue = new Scheduler(async);

let handlers = createHandlers(isPromise, handlerForPromise, registerRejection, taskQueue);
let { handlerFor, handlerForMaybeThenable, Deferred, Fulfilled, Rejected, Async, Never } = handlers;

export class Promise {
    constructor(handler) {
        this._handler = handler;
    }

    then(f, r) {
        return new Promise(then(f, r, this._handler));
    }

    catch(r) {
        return this.then(null, r);
    }
}

function then(f, r, h) {
    let s = h.state();

    if(((s & FULFILLED) > 0 && typeof f !== 'function') ||
        ((s & REJECTED) > 0 && typeof r !== 'function')) {
        return h;
    }

    let handler = new Deferred();
    h.when(new Then(f, r, handler));
    return handler;
}

class Then {
    constructor(f, r, next) {
        this.f = f;
        this.r = r;
        this.next = next;
    }

    fulfilled(handler) {
        return runAction(this.f, handler, this.next);
    }

    rejected(handler) {
        return runAction(this.r, handler, this.next);
    }
}

function runAction(f, handler, next) {
    if(typeof f !== 'function') {
        next.become(handler);
        return false;
    }

    tryCatchNext(f, handler.value, next);
    return true;
}

function tryCatchNext(f, x, next) {
    try {
        next.resolve(f(x));
    } catch(e) {
        next.reject(e);
    }
}

function isPromise(x) {
    return x instanceof Promise;
}

function handlerForPromise(p) {
    return p._handler.join();
}

export function promise(f) {
    return new Promise(new Resolver(f));
}

export function resolve(x) {
    return isPromise(x) ? x : new Promise(new Async(handlerFor(x)));
}

export function reject(x) {
    return new Promise(new Async(new Rejected(x)));
}

export function all(promises) {
    if(typeof promises !== 'object' || promises === null) {
        return reject(new TypeError('non-iterable passed to all()'));
    }

    return new Promise(new All(promises));
}

export function race(promises) {
    if(typeof promises !== 'object' || promises === null) {
        return reject(new TypeError('non-iterable passed to race()'));
    }

    return promises.length === 0 ? never()
        : new Promise(new Race(promises));
}

let neverPromise = new Promise(new Never());

export function never() {
    return neverPromise;
}

function maybeThenable(x) {
    return (typeof x === 'object' || typeof x === 'function') && x !== null;
}

class Resolver extends Deferred {
    constructor(f) {
        super();
        init(f, x => this.resolve(x), e => this.reject(e));
    }
}

function init(f, resolve, reject) {
    try {
        f(resolve, reject);
    } catch (e) {
        reject(e);
    }
}

class All extends Deferred {
    constructor(array) {
        super();
        this.pending = array.length;
        this.resolveAll(array);
    }

    resolveAll(array) {
        let results = new Array(this.pending);
        let i = 0;
        for(let x of array) {
            if(maybeThenable(x)) {
                this.handleAt(results, i, x);
            } else {
                this.fulfillAt(results, i, x);
            }

            if(this.pending === 0) {
                break;
            }

            ++i;
        }

        this.check(results);
    }

    handleAt(results, i, x) {
        let h = handlerForMaybeThenable(x);
        let s = h.state();

        if((s & FULFILLED) > 0) {
            this.fulfillAt(results, i, h.value);
        } else if((s & REJECTED) > 0) {
            this.rejectAt(h);
        } else {
            h.when(new SettleAt(this, results, i));
        }
    }

    fulfillAt(results, i, x) {
        results[i] = x;
        this.pending--;
        this.check(results);
    }

    rejectAt(handler) {
        this.pending = 0;
        this.become(handler);
    }

    check(results) {
        if(this.isPending() && this.pending === 0) {
            this.fulfill(results);
        }
    }
}

class SettleAt {
    constructor(all, results, index) {
        this.all = all;
        this.results = results;
        this.index = index;
    }

    fulfilled(handler) {
        this.all.fulfillAt(this.results, this.index, handler.value);
        return true;
    }

    rejected(handler) {
        this.all.rejectAt(handler);
        return true;
    }
}

class Race extends Deferred {
    constructor(array) {
        super();
        this.resolveRace(array);
    }

    resolveRace(array) {
        let i = 0;
        for(let x of array) {
            if(maybeThenable(x)) {
                let h = handlerForMaybeThenable(x);
                if((h.state() & SETTLED) > 0) {
                    visitRemaining(array, i+1, h);
                    this.become(h);
                    break;
                }

                h.when(this);
            } else {
                visitRemaining(array, i+1, void 0);
                this.fulfill(x);
                break;
            }

            ++i;
        }
    }

    fulfilled(handler) {
        this.become(handler);
        return true;
    }

    rejected(handler) {
        this.become(handler);
        return true;
    }
}

const silenceRejection = {
    rejected()  { return true; },
    fulfilled() { return true; }
};

function visitRemaining(promises, start, handler) {
    for(let i=start, l = promises.length; i<l; ++i) {
        let h = handlerFor(promises[i]);
        if (h !== handler && (h.state() & FULFILLED) === 0) {
            h.when(silenceRejection);
        }
    }
}

export function lift(f) {
    return function(...args) {
        return applyp(f, this, args);
    }
}

export function merge(f, ...args) {
    return applyp(f, this, args);
}

function applyp(f, thisArg, args) {
    return new Promise(new Merge(f, thisArg, args));
}

class Merge extends All {
    constructor(f, c, promises) {
        super(promises);
        this.f = f;
        this.c = c;
    }

    fulfill(results) {
        try {
            this.resolve(this.f.apply(this.c, results));
        } catch(e) {
            this.reject(e);
        }
    }
}

// Node-style async function to promise-returning function
// (a -> (err -> value)) -> (a -> Promise)
import createDenodeify from './node';
let runNode = createDenodeify(Deferred);

export function denodeify(f) {
    return function(...args) {
        return new Promise(runNode(f, this, args));
    };
}

// Generator to coroutine
// Generator -> (a -> Promise)
import createStepper from './co.js';
let runCo = createStepper(handlerFor, Deferred);

export function task(generator) {
    return function(...args) {
        return runGenerator(generator, this, args);
    };
}

function runGenerator(generator, thisArg, args) {
    return new Promise(runCo(generator.apply(thisArg, args)));
}

(function(TruthPromise, Resolver, resolve, reject, all, race) {

    var g;
    if(typeof self !== 'undefined') {
        g = self;
    } else if(typeof global !== 'undefined') {
        g = global;
    } else {
        return;
    }

    if(typeof g.Promise !== 'function') {
        g.Promise = class Promise extends TruthPromise {
            constructor(f) {
                super(new Resolver(f));
            }
        };

        Promise.resolve = resolve;
        Promise.reject  = reject;
        Promise.all     = all;
        Promise.race    = race;
    }

}(Promise, Resolver, resolve, reject, all, race));
