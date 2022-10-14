import * as S from './index.js'

let state = {
    a1: {
        b1: {
            c1: 0,
            c2: 0
        },
        b2: {
            c3: 0,
            c4: 0
        }
    },
    a2: {
        b3: 0,
        b4: 0
    },
}

type $ = { read: any, write: any, notify: any }

/**
 * Idea I'm messing with here is, Z has mutual dependencies
 * if a child updates, parent should be notified of change
 * so subscribers to the parent can be notified
 * 
 * e.g. if a.b.c changed, a.b changed and a change
 * 
 * But, a.e.f did not necessarily change
 * 
 * So when someone reads a.b they need to be listening to a different
 * channel than a.e.f.
 * 
 * But if a changed, a.e.f and a.b and a.b.c all changed and should all
 * emit at least internally.
 * 
 * Maybe there's some value checking with a global equality function that
 * defaults to ===.  If if the parent emit but the downstream value is the
 * same, the library user won't be notified.
 * 
 * I tried this once before and came up with this write/read/modify
 * abstraction.
 * 
 * read was a computation that subscribed to all parent changes
 * and when a child is created, it tells all parents to subscribe to
 * the notify channel
 * 
 * there'll end up being a lot of computations for even a simple query
 * but S is actually pretty cheap, and we're going to be skipping vdom diffing
 * in practice and a lot of other work so it is probably fine.
 * 
 * Now, no idea if this actually works or makes sense, need to mess with it.
 * But at least now I've rewritten S and sort of understand that I can see
 * how to graft this as a thin layer on top.  Maybe it's not to be, but worth
 * a try.
 */

let state$: $; {
    
    let write = S.data(state)
    let read = () => write()
    let notify = () => {}

    state$ = {
        read,
        write,
        notify
    }
}

let state$a1$: $; {
    let write = S.data()

    // when a write happens update state
    S.computation(() => {
        let value = write()
        state.a1 = value as typeof state["a1"]
        state$.notify()
    })

    S.computation(() => {
        
        let a1 = state$.read() as typeof state["a1"]

        
    })

    let read = () => state.a1;
}
