import test from 'tape'
import * as S from '../lib/index.js'

test('basic freeze', t => {

    S.root(() => {
        const a = S.data(1)
        const b = S.data(2)

        const results: number[] = []
        S.computation(() => {
            results.push(a() + b())
        })
        S.freeze(() => {
            a(2)
            b(3)
            b(3)
        })

        t.deepEquals(results, [3,5])
    })
    t.end()
})

test('staggered computations', t => {

    S.root(() => {

        S.stats.ticks = 0
        S.stats.computations.evaluated = 0

        const organizations =
            [{ o_id: 1, name: 'Harth' }, { o_id: 2, name: 'DPHOTO'}]

        const schedules =
            [{ o_id: 1, s_id: 1, name: 'Bute' }
            , { o_id: 1, s_id: 2, name: 'Odin' }
            , { o_id: 2, s_id: 3, name: 'Lightbox' }
            ]

        const projects =
            [ { s_id: 1, p_id: 1, name: 'App Store Submission' }
            , { s_id: 3, p_id: 2, name: 'Automated Billing' }
            ]

        const o_id = S.data<number>()
        const s_id = S.data<number>()
        const p_id = S.data<number>()

        const emitted : any[] = [];
        const emit = (x:any) => {
            emitted.push(x)
            return x
        }

        const o = S.computation(() => {
            return emit(organizations.find( x => x.o_id === o_id() ))
        })
        const s = S.computation(() => {
            return emit(schedules.find((x) => {
                return x.o_id == o()?.o_id && x.s_id == s_id()
            }))
        })
        const p = S.computation(() => {
            return emit(projects.find( x => {
                return x.s_id == s()?.s_id
            }))
        })

        S.freeze(() => {
            o_id(1)
            s_id(1)
            p_id(1)
        })

        t.deepEquals(emitted, [
            undefined,
            undefined,
            undefined,
            { o_id: 1, name: 'Harth' },
            { o_id: 1, s_id: 1, name: 'Bute' },
            { s_id: 1, p_id: 1, name: 'App Store Submission' }
        ], 'All downstream objects emitted once from freeze update')

        t.equals(
            S.stats.ticks, 1, 'only 1 tick (other than init)'
        )
        t.equals(
            S.stats.computations.evaluated, 3, 'only 1 computation per object (other than init)'
        )

        emitted.length = 0
        o_id(2)
        t.deepEquals(emitted, [ { o_id: 2, name: 'DPHOTO' }, undefined, undefined ], 'Invalid id combination works as expected')

        emitted.length = 0

        S.freeze(() => {
            s_id(3)
            p_id(2)
            t.deepEquals(emitted, [], 'No emits while frozen')
        })

        t.deepEquals(emitted, [
            { o_id: 2, s_id: 3, name: 'Lightbox' },
            { s_id: 3, p_id: 2, name: 'Automated Billing' }
        ], 'Emits occur after freeze')

    })
    // when org id changes
    // nullify schedule_id
    // clear schedules list

    // when schedules list is upd
    t.end()
})

test('multiple writes in 1 computation', t => {
    S.root(() => {
        const a = S.data(0)
        const b = S.data(0)
        const c = S.data(0)

        S.stats.ticks = 0
        S.stats.computations.evaluated = 0

        // because this computation triggers a write
        // we run a tick, once the tick is done, it sees
        // there are two writes scheduled, so it freezes time
        // and evaluates those writes, which triggers one more tick
        // that includes the propagations for both those writes in one go
        //
        // at definition time, the bottom two computations haven't been defined
        // yet, so not much happens
        // 
        // later we write to a, this computation depends on a so it runs while propagating
        // that tick
        // that tick then has more writes scheduled, so it processes them in a freze
        // so 2 ticks each time, total of 4
        S.computation(() => {
            b(a() + 1)
            c(a() + 2)
        })

        // on the first 2 ticks, these aren't defined yet
        // after we write to a, these both run exactly once each
        S.computation(() => {
            b()
        })
        
        S.computation(() => {
            c()
        })

        t.equals(S.stats.ticks, 2, '1 for the initial computation running, another for the writes')
        t.equals(S.stats.computations.evaluated, 0, 'the first tick ran no computations')

        a(1)
        t.equals(S.stats.ticks, 2 + 2, '1 for the first computation re-running, another for the writes')
        t.equals(S.stats.computations.evaluated, 3, 'the write triggered all 3 to run 1 time')
    })

    t.end()
})

