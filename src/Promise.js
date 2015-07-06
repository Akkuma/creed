'use strict';
import Scheduler from './Scheduler';
import async from './async';
import registerRejection from './registerRejection';
import maybeThenable from './maybeThenable';
import silenceRejection from './silenceRejection';
import { makeRefTypes, isPending, isFulfilled, isRejected, isSettled } from './refTypes';
import { PENDING, RESOLVED, FULFILLED, REJECTED, HANDLED } from './state';

import then from './then';
import delay from './delay';
import timeout from './timeout';

import Any from './Any';
import Race from './Race';
import Merge from './Merge';
import Settle from './Settle';
import resolveIterable from './iterable';

import runNode from './node';
import runCo from './co.js';

let taskQueue = new Scheduler(async);

let { handlerFor, handlerForMaybeThenable, Deferred, Fulfilled, Rejected, Async, Never }
    = makeRefTypes(isPromise, handlerForPromise, registerRejection, taskQueue);

//----------------------------------------------------------------
// Promise
//----------------------------------------------------------------

class Promise {
    constructor(handler) {
        this._handler = handler;
    }

    then(f, r) {
        return new this.constructor(then(Deferred, f, r, handlerForPromise(this)));
    }

    catch(r) {
        return this.then(null, r);
    }

    delay(ms) {
        return new this.constructor(delay(Deferred, ms, handlerForPromise(this)));
    }

    timeout(ms) {
        return new this.constructor(timeout(Deferred, ms, handlerForPromise(this)));
    }
}

function isPromise(x) {
    return x instanceof Promise;
}

function handlerForPromise(p) {
    return p._handler;
}

//----------------------------------------------------------------
// Creating promises
//----------------------------------------------------------------

export function resolve(x) {
    if (isPromise(x)) {
        return x;
    }

    let h = handlerFor(x);
    return new Promise((h.state() & PENDING) > 0 ? h : new Async(h));
}

export function reject(x) {
    return new Promise(new Async(new Rejected(x)));
}

export function promise(f) {
    return new Promise(runResolver(f));
}

function runResolver(f) {
    let h = new Deferred();

    try {
        f(x => h.resolve(x), e => h.reject(e));
    } catch (e) {
        h.reject(e);
    }

    return h;
}

let neverPromise = new Promise(new Never());

export function never() {
    return neverPromise;
}

//----------------------------------------------------------------
// Arrays & Iterables
//----------------------------------------------------------------

export function all(promises) {
    checkIterable('all', promises);
    return new Promise(iterableRef(new Merge(allHandler, resultsArray(promises)), promises));
}

const allHandler = {
    merge(ref, args) {
        ref.fulfill(args);
    }
};

export function race(promises) {
    checkIterable('race', promises);
    return new Promise(iterableRef(new Race(), promises));
}

export function any(promises) {
    checkIterable('any', promises);
    return new Promise(iterableRef(new Any(), promises));
}

export function settle(promises) {
    checkIterable('settle', promises);
    return new Promise(iterableRef(new Settle(stateForValue, resultsArray(promises)), promises));
}

function stateForValue(x) {
    return new Fulfilled(x);
}

function iterableRef(handler, iterable) {
    return resolveIterable(handlerForMaybeThenable, handler, iterable, new Deferred());
}

function checkIterable(kind, x) {
    if(typeof x !== 'object' || x === null) {
        throw new TypeError('non-iterable passed to ' + kind);
    }
}

function resultsArray(iterable) {
    return Array.isArray(iterable) ? new Array(iterable.length) : [];
}

//----------------------------------------------------------------
// Lifting
//----------------------------------------------------------------

// (a -> b) -> (Promise a -> Promise b)
export function lift(f) {
    return function(...args) {
        return applyp(f, this, args);
    }
}

// (a -> b) -> Promise a -> Promise b
export function merge(f, ...args) {
    return applyp(f, this, args);
}

function applyp(f, thisArg, args) {
    return new Promise(runMerge(f, thisArg, args));
}

function runMerge(f, thisArg, args) {
    return iterableRef(new Merge(new MergeHandler(f, thisArg), resultsArray(args)), args);
}

class MergeHandler {
    constructor(f, c) {
        this.f = f;
        this.c = c;
    }

    merge(ref, args) {
        try {
            ref.resolve(this.f.apply(this.c, args));
        } catch(e) {
            ref.reject(e);
        }
    }
}

//----------------------------------------------------------------
// Convert node-style async
//----------------------------------------------------------------

// Node-style async function to promise-returning function
// (a -> (err -> value)) -> (a -> Promise)
export function denodeify(f) {
    return function(...args) {
        return new Promise(runNode(f, this, args, new Deferred()));
    };
}

//----------------------------------------------------------------
// Generators
//----------------------------------------------------------------

// Generator to coroutine
// Generator -> (a -> Promise)
export function co(generator) {
    return function(...args) {
        return runGenerator(generator, this, args);
    };
}

function runGenerator(generator, thisArg, args) {
    var iterator = generator.apply(thisArg, args);
    var d = new Deferred();
    return new Promise(runCo(handlerFor, d, iterator));
}

//----------------------------------------------------------------
// ES6 Promise polyfill
//----------------------------------------------------------------

(function(TruthPromise, runResolver, resolve, reject, all, race) {

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
                super(runResolver(f));
            }
        };

        Promise.resolve = resolve;
        Promise.reject  = reject;
        Promise.all     = all;
        Promise.race    = race;
    }

}(Promise, runResolver, resolve, reject, all, race));
