import xet from 'xet';

export let dependents = new WeakMap();
export let cleanups = new Map();
export let active = []
export const toRun = new Set()
export let propagating = false;
export let batching = false;
export const stats = {
    ticks: 0,
    computations: {
        evaluated: 0
    }
}

class SError extends Error {}
class CleanupWithoutComputationContext extends SError {}

export function sample(signal){
    let oldActive = active
    active = [];
    let value = signal()
    active = oldActive
    return value;
}

export function data(initial){
    let stream = { value: initial }

    return function(...args){
        if( args.length ) {
            if ( typeof args[0] === 'function' ) {
                stream.value = args[0](stream.value)
            } else {
                stream.value = args[0]
            }
            
            let stack = []
            stack.push(...xet(dependents, stream, () => new Set()))

            while (stack.length) {
                let x = stack.shift()

                stack.push(...xet(dependents, x, () => new Set()))

                toRun.add(x)
                dependents.get(stream).delete(x)
                
            } 
            
            if( !propagating && !batching ) {
                tick()
            }
        } else {
            if ( active[0] ) {
                xet(dependents, stream, () => new Set())
                    .add(active[0])
            }
        }
        
        return stream.value
    }
}

export function computation(visitor){
    let stream = { 
        id: Math.random().toString(15).slice(2,4),
        value: null, 
        next: null,
        visitor, 
        compute: () => {
            active.unshift(stream)
            stream.next = visitor() 
            active.shift()
            return () => stream.value = stream.next
        }
    }
    
    
    active.unshift(stream)
    
    stream.value = visitor()
    
    active.shift()
    
    return () => {
        if ( active[0] ) {
            xet(dependents, stream, () => new Set())
                .add(active[0])
        }
        return stream.value;
    }
}

export function batch(f){
    let oldBatching = batching
    batching = true
    f()
    batching = oldBatching
    tick();
}

export function cleanup(f){
    if ( active[0] ) {
        xet(cleanups, active[0], () => new Set())
            .add(f)
    } else {
        throw new CleanupWithoutComputationContext()
    }
}

export function root(f){
    f(() => {
        for( let xs of cleanups.values() ){
            for( let cleanupFn of xs ) {
                cleanupFn()
            }
        }
        cleanups.clear()
    })
}

export function tick(){
    if (propagating) return;

    stats.ticks++

    propagating = true
    let updates = []
    
    let items = [...toRun]
    toRun.clear();
    for( let f of  items) {
        for( let cleanupFn of xet(cleanups, f, () => new Set())) {
            cleanupFn()
            cleanups.get(f).delete(cleanupFn)
        }

        stats.computations.evaluated++
        updates.push(f.compute())
    }
    
    for ( let f of updates ) {
        f()
    }
    
    propagating = false
}
