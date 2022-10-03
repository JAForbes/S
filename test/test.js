import * as S from '../lib/index.js'
import test from 'tape'

test('data', t => {
    const a = S.data(1)
    const b = S.data(2)

    t.equals(a(), 1, 'data is a getter and a setter 1/2')
    t.equals(b(), 2, 'data is a getter and a setter 1/2')
    t.end()
})

test('ticks', t => {
    S.stats.ticks = 0
    const a = S.data(1)

    t.equals(S.stats.ticks, 0, 'No ticks required as no write happened')

    a(2)

    t.equals(S.stats.ticks, 1, 'tick triggered')

    let b = S.computation(() => {
        return a()
    })

    t.equals(S.stats.ticks, 1, 'No writes occurred so no tick needed')

    t.equals(b(), a(), 'b = a')

    a(3)

    t.equals(S.stats.ticks, 2, 'Write occurred, so a tick needed')

    t.equals(b(), a(), 'b = a')


    t.end()
})

test('batch', t => {
    S.stats.ticks = 0
    const a = S.data(1)
    const b = S.data(2)

    let c = S.computation(() => {
        return a() + b()
    })

    t.equals(S.stats.ticks, 0, 'No writes yet, so no ticks')

    S.batch(() => {
        a(2)
        b(3)
    })

    t.equals(S.stats.ticks, 1, '1 batch write, so 1 tick')

    t.equals(c(), a() + b(), 'c = a + b')

    t.end()
})

// we don't track when computations are read _yet_
// so this fails
test('nested computations', t => {
    S.stats.ticks = 0
    let a = S.data(2);
    let b = S.data(3);

    // 6. c will be in sync if a or b changes
    // but these inner computations will run
    // wastefully multiple times
    // also there is no guarantee of order either
    let c = S.computation(() => {

        // 4. c$ updates whenever a or b changes
        // too
        let c$ =  S.computation(() => {

            // 1. the value of c$$ is updated
            let c$$ = S.computation(() => {
                // 2. when a or b updates
                return a() + b()
            })

            // 3. and as it is referenced here
            // the value of the outer computation needs to re-evaluate
            return c$$()
        })

        // 5. and as c$ is evaluated here, the outer block
        // needs to update when a or b changes
        return c$()
    })
    // 7. this is correct, but wasteful, because we evaluate c$$ 3 times
    // one time per computation layer, we could instead say, hey c$$ updated
    // update the outer layer one time
    //
    // 8. we may also have a problem where each inner computation running
    // creates duplicate computations, again, this is "correct" but wasteful
    // as we only want 1 per source computation
    //
    // 9. I do not know a way around this, and yet, this seems like
    // a pretty normal thing to do, not all at once, but defining data
    // in a computation that happens to be inside another computation
    // e.g. in Solid aren't all components computations, or is only the view...
    //
    // 10. But maybe that is fine, maybe components aren't wrapped in a
    // computation, only the view, but I was under the impression
    // components were re-evaluated if the parent component re-ran, how
    // does that work?

    t.equals(c(), a() + b(), 'c() = a() + b()')
    t.equals(c(), 5, 'smoke')
    
    a(7)
    c();

    t.equals(c(), a() + b(), 'c() = a() + b()')
    t.equals(c(), 10, 'smoke')

    t.equals(S.stats.ticks, 1, '1 write = 1 tick')
    t.end()
})

test('define data inside a computation', t => {
    S.stats.ticks = 0

    S.computation(() => {
        let a = S.data(2)
        let b = S.data(3)

        let c = S.computation(() => a() + b())

        t.equals(c(), a() + b(), 'c = a + b')

        t.end()
    })
})

test('cleanup', t => {

    S.root((dispose) => {

        S.stats.ticks = 0
    
        let domNode = S.data('#a')
        let listeners = {}
        let addEventListener = (event, node, f) => {
            listeners[node+'.on'+event] = f
        }
        let removeEventListener = (event, node) => {
            console.log('deleteing listener for ',node,event)
            delete listeners[node+'.on'+event]
        }
        
        S.computation(() => {
    
            let f = () => {}
            let node = domNode()
            addEventListener('click', node, f)
    
            S.cleanup(() => {
                removeEventListener('click', node, f)
            })
        })
    
        t.equals(Object.keys(listeners).join('|'), '#a.onclick', '#a listener exists')
        domNode('#b')
        t.equals(Object.keys(listeners).join('|'), '#b.onclick', '#b listener exists')

        dispose()

        t.equals(Object.keys(listeners).join('|'), '', 'all listeners cleaned up')
    })


    t.end()
})

test('sample', t => {
    S.stats.ticks = 0
    S.stats.computations.evaluated = 0

    let a = S.data(1)
    let b = S.data(2)

    let c = S.computation(() => {
        return S.sample(a) + b()
    })

    t.equal(c(), a() + b(), 'c = a + b')
    t.equals(S.stats.ticks, 0, 'No writes, no ticks')

    a(100)

    t.equals(S.stats.ticks, 1, 'Write = tick but...')
    t.equals(S.stats.computations.evaluated, 0, 'the tick didn\'t do anything')

    t.notEqual(c(), a() + b(), 'c <> a + b')

    b(1)
    t.equals(S.stats.ticks, 2, 'b written too, so tick occurred')

    t.equal(c(), a() + b(), 'c = a + b')
    t.equals(S.stats.computations.evaluated, 1, 'the tick evaluated the computation because a non sampled dependency was written to')

    t.end()
})