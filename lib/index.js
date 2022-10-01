import xet from 'xet';

export let dependents = new WeakMap();
export let cleanups = new Map();
export let active = null
export const toRun = new Set()
export let propagating = false;
export let batching = false;
export const stats = {
    ticks: 0
}

class SError extends Error {}
class CleanupWithoutComputationContext extends SError {}

export function data(initial){
    let stream = { value: initial }

    return function(...args){
        if( args.length ) {
            stream.value = args[0]
            
            for( let x of xet(dependents, stream, () => new Set()) ) {
                toRun.add(x)
                
                // now we are scheduled to run
                // forget we depend on this stream
                // so we can recompute dependencies next tick
                dependents.get(stream).delete(x)
            }
            
            if( !propagating && !batching ) {
                tick()
            }
        } else {
            if ( active ) {
                xet(dependents, stream, () => new Set())
                    .add(active)
            }
        }
        
        return stream.value
    }
}

export function computation(visitor){
    let stream = { 
        value: null, 
        next: null,
        visitor, 
        compute: () => {
            active = stream
            stream.next = visitor() 
            active = null
            return () => stream.value = stream.next
        }
    }
    
    console.log('active = ', stream)
    active = stream
    
    stream.value = visitor()
    
    active = null
    console.log('active = ', null)
    
    return () => stream.value = visitor();
}

export function batch(f){
    let oldBatching = batching
    batching = true
    f()
    batching = oldBatching
    tick();
}

export function cleanup(f){
    if ( active ) {
        console.log('cleanup active', active)
        xet(cleanups, active, () => new Set())
            .add(f)
    } else {
        console.log('cleanup inactive', active)
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
    
    for( let f of toRun ) {
        for( let cleanupFn of xet(cleanups, f, () => new Set())) {
            cleanupFn()
            cleanups.get(f).delete(cleanupFn)
        }

        updates.push(f.compute())
    }
    
    for ( let f of updates ) {
        f()
    }
    toRun.clear();
    propagating = false
}