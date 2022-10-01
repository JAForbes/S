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

test('nested computations', t => {
    S.stats.ticks = 0
    let a = S.data(2);
    let b = S.data(3);
    let c = S.computation(() => {
        let c$ =  S.computation(() => {

            let c$$ = S.computation(() => {
                return a() + b()
            })

            return c$$()
        })
        return c$()
    })

    t.equals(c(), a() + b(), 'c() = a() + b()')
    t.equals(c(), 5, 'smoke')
    
    a(7)

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