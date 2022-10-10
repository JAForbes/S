import test from 'tape'
import * as S from '../lib/index.js'

test('data', t => {
    S.root(() => {
        const a = S.data(1)
        const b = S.data(2)
        const c = S.data<number>();
    
        t.equals(a(), 1, 'data is a getter and a setter 1/2')
        t.equals(b(), 2, 'data is a getter and a setter 1/2')
        t.end()
    })
})

test('ticks', t => {
    S.root(() => {
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
})

test('batch', t => {
    S.root(() => {
        S.stats.ticks = 0
        const a = S.data(1)
        const b = S.data(2)
    
        let c = S.computation(() => {
            return a() + b()
        })
    
        t.equals(S.stats.ticks, 0, 'No writes yet, so no ticks')
    
        S.freeze(() => {
            a(2)
            b(3)
        })
    
        t.equals(S.stats.ticks, 1, '1 batch write, so 1 tick')
    
        t.equals(c(), a() + b(), 'c = a + b')
    
        t.end()
    })
})

test('child computations are cleaned up when parent updates', t => {
    S.root(() => {
        let outer = S.data(1)
        let middle = S.data(1)
        let inner = S.data(1)
    
        let ids = []
        let stats = {
            outer: 0,
            middle: 0,
            inner : 0
        }
    
        S.computation(() => {
            ids.push( Math.random().toString(15).slice(2) )
            outer()
            stats.outer++
            let middle$ = S.computation(() => {
                ids.push( Math.random().toString(15).slice(2) )
                middle()
                stats.middle++
                let inner$ = S.computation(() => {
                    ids.push( Math.random().toString(15).slice(2) )
                    inner()
                    stats.inner++
                })
    
                inner$()
            })
    
            middle$()
        })
    
        t.equals(Object.values(stats).join('|'), '1|1|1', 'all levels initialized (outer)')
        
        // the inner computations runs before the outer ones in the tick
        // which means when each outer computation runs, it re-evaluates
        // the inner ones that have already run
        // if we ran the outer computations first, it the inner would run for free
        // and we'd be able to skip the children of each computation
        // as we progressed through the tick
        //
        // we could sort the list by how many parents a computation had (ascending)
        // but I'm wondering if there's a way to do that more naively/automatically
        // by e.g. just pushing onto a stack, or ticking in reverse order
        //
        // another thing to consider, if we werent' calling inner$() inside middle$()
        // then middle$() wouldn't need to re-run, only inner would, but
        // when inner re-ran, active wouldn't include middle and outer, it'd be empty
        // which is wrong, we need to not forget the previous parents when re-running
        // a computation, should just be a matter of altering the active stack
        // inside the tick loop
        //
        // so two small changes, that should hopefully make this pass
        //
        // Update: yep we get this for free, when we traverse we just check 
        // if any of our parents are scheduled for propagation (set intersection)
        // if so, we take ourselves out of the loop (aside from cleanup)
        inner(2)
        t.equals(Object.values(stats).join('|'), '2|2|2', 'all levels initialized (outer)')
        
        console.log(stats)
    
        t.end()
    })
})


// we don't track when computations are read _yet_
// so this fails
test('nested computations', t => {
    S.root(() => {
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
})


test('data setter fn', t => {
    S.root(() => {
        let a = S.data(1)
    
        let renders = 0;
        let c = S.computation(() => {
            renders++
            a()
        })
    
        t.equals(renders, 1, '1 render for initial value')
    
        a( x => x + 1 )
    
        t.equals(renders, 2, '1 write = 1 render')
        t.equals(a(), 2, 'fn setter works')
        t.end()
    })
})


test('components?', t => {
    S.root(() => {

        S.stats.ticks = 0
    
        function Button({ onclick }: { onclick: VoidFunction }, text: string){
            let redraws = 0
            let out = {
                get redraws(){
                    return redraws
                },
                view: S.computation(() => {
                    redraws++
                    return text
                }),
                onclick
            }
            return out
        }
    
        function ShowCount({ count }: { count: S.Signal<number> }){
            
            let redraws = 0
            let out = {
                get redraws(){
                    return redraws
                },
                view: S.computation(() => {
                    redraws++
                    return 'The count is ' + count()
                }),
                onclick(){}
            }
            return out;
        }
    
        function Counter(){
    
            let count = S.data(0)
    
            let redraws = 0
            let out = {
                get redraws(){
                    return redraws
                },
                count,
                view: S.computation(() => {
                    redraws++
                    return [
                        ShowCount({ count }),
                        Button({ onclick: () => count( x => x + 1) }, '+'),
                        Button({ onclick: () => count( x => x - 1) }, '-')
                    ]
                }),
                onclick(){}
            }
    
            return out;
        }
    
        let counter = Counter()
    
        let showCount = () => counter.view()![0]
        let inc = () => counter.view()![1]
        let dec = () => counter.view()![2]
        
        t.equals(showCount().view(), 'The count is 0', 'ShowCount')
        t.equals(inc().view(), '+', '+')
        t.equals(dec().view(), '-', '-')
        t.equals(S.stats.ticks, 0, 'No writes no ticks')
    
        t.equals(counter.redraws, 1, 'counter.redraws = 1')
        t.equals(showCount().redraws, 1, 'showCount.redraws = 1')
        t.equals(inc().redraws, 1, 'inc.redraws = 1')
        t.equals(dec().redraws, 1, 'dec.redraws = 1')
    
        inc().onclick()
    
        t.equals(showCount().view(), 'The count is 1', 'ShowCount')
        t.equals(inc().view(), '+', '+')
        t.equals(dec().view(), '-', '-')
        t.equals(S.stats.ticks, 1, '1 write, 1 tick')
    
        t.equals(counter.redraws, 1, 'counter.redraws = 1')
        t.equals(showCount().redraws, 2, 'showCount.redraws = 2')
        t.equals(inc().redraws, 1, 'inc.redraws = 1')
        t.equals(dec().redraws, 1, 'dec.redraws = 1')
    
        // because time is froze
        // we're just decrementing the same value
        // multiple times, so we get 0 instead of -3
        S.freeze(() => {
            dec().onclick()
            dec().onclick()
            dec().onclick()
            dec().onclick()
        })
    
        t.equals(showCount().view(), 'The count is 0', 'ShowCount')
        t.equals(inc().view(), '+', '+')
        t.equals(dec().view(), '-', '-')
        t.equals(S.stats.ticks, 2, '2 write, 2 tick')
    
        t.equals(counter.redraws, 1, 'counter.redraws = 1')
        t.equals(showCount().redraws, 3, 'showCount.redraws = 3')
        t.equals(inc().redraws, 1, 'inc.redraws = 1')
        t.equals(dec().redraws, 1, 'dec.redraws = 1')
    
        t.end()
    })
})


test('define data inside a computation', t => {
    S.root(() => {
        S.stats.ticks = 0
    
        S.computation(() => {
            let a = S.data(2)
            let b = S.data(3)
    
            let c = S.computation(() => a() + b())
    
            t.equals(c(), a() + b(), 'c = a + b')
    
            t.end()
        })
    })
})


test('cleanup', t => {
    S.root((dispose) => {

        S.stats.ticks = 0
    
        let domNode = S.data('#a')
        let listeners : Record<string,VoidFunction> = {}
        let addEventListener = (event:string, node:string, f:VoidFunction) => {
            listeners[node+'.on'+event] = f
        }
        let removeEventListener = (event:string, node:string) => {
            console.log('deleteing listener for ',node,event)
            delete listeners[node+'.on'+event]
        }
        
        S.computation(() => {
    
            let f = () => {}
            let node = domNode()
            addEventListener('click', node, f)
    
            S.cleanup(() => {
                removeEventListener('click', node)
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
    S.root(() => {

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
})

test('generators?', async t => {
    // the idea is, auto dependency tracking is incompatible with
    // async code, because while you await some task to complete
    // another computation may have overridden your active context
    // and references will be misattributed to that other context
    let a$ = S.data(1)
    let b$ = S.data(2)

    let computations = {
        preYieldC: 0,
        postYieldC: 0,
        d: 0,
        a$Listener: 0,
        b$Listener: 0,
        dListener: 0,
        cListener: 0
    }

    let values: Record<string, number | undefined> = {
        cInner: undefined
    }

    S.root(() => {

        // but generators suspend their context
        // and then can be resumed, and we can set those global
        // variables as and when each generator is suspended
        // and resumed
        let c = S.generator<number>(function * (){ 
            let a = a$()
    
            computations.preYieldC++
            // e.g. here we pause the context while
            // this async logic runs
            yield new Promise( Y => setTimeout(Y, 10) )
            // here we resume it
    
            computations.postYieldC++
            // you can imagine setting active=null when we yield
            // and active=generator when we resume
    
            // that means when b$ is referenced here
            // we can associate it with this context
            // and if it later changes, restart the 
            // generator
            let b = b$()
    
            values.cInner = a + b
            return a + b
        })
    
        // here is a synchronous computation
        // we reference an async computation
        // problem to be solved: what is the value of c when
        // the generator has not yet completed
        // I guess it is just undefined, that's how S already
        // works
        let d = S.computation(() => {
            // console.log(c(), c()! +1)

            computations.d++
            values.dInner = (c()!) + 1
            return (c()!) + 1
        })
    
        // another problem to be solved, ticks
        // rely on a set of computations to rerun
        // and a dependency look up
    
        // but while we're awaiting an async context
        // we may want to run other ticks
        // we may need to give up on the concept 
        // of single instance ticks in order to support
        // async control flow?
    
        // or I suppose if a dependency re-evaluates
        // we simply cancel the existing async
        // computation, and ticks, remain
        // sync
    
        S.computation(() => {
            computations.cListener++

            values.cListener = c()
        })
        S.computation(() => {
            computations.a$Listener++
            values.a$Listener = a$()
        })
        S.computation(() => {
            computations.b$Listener++
            values.b$Listener = b$()
        })
        S.computation(() => {
            computations.dListener++
            values.dListener = d()
        })
    })

    t.equals(
        Object.values(computations).join('|')
        , [1, 0, 1, 1, 1, 1, 1].join('|')
        , 'all computations ran once except post yield'
    )

    t.equals(
        Object.values(values).join('|')
        , [undefined, NaN, undefined, 1, 2, NaN ].join('|')
        , 'c values are undefined, d is NaN as it depends on C'
    )

    await new Promise( Y => setTimeout(Y, 10) )

    t.equals(
        Object.values(values).join('|')
        , [3, 3 + 1, 3, 1, 2, 3 + 1 ].join('|')
        , 'c values are resolved, d is now not NaN'
    )

    t.equals(
        Object.values(computations).join('|')
        , [1, 1, 2, 1, 1, 2, 2 ].join('|')
        , 'post yield and async listeners ran'
    )
    
    a$(2)

    t.equals(
        Object.values(computations).join('|')
        , [2, 1, 2, 2, 1, 2, 2].join('|')
        , 'all computations ran once except post yield and b listener'
    )

    await new Promise( Y => setTimeout(Y, 20) )

    t.equals(
        Object.values(computations).join('|')
        , [2, 2, 3, 2, 1, 3, 3].join('|')
        , 'post yield and async listeners ran'
    )

    t.equals(values.cInner, values.cListener, 'c is in sync')
    t.equals(values.dInner, values.dListener, 'd is in sync')
    t.equals(values.a$Listener, a$(), 'a is in sync')
    t.equals(values.b$Listener, b$(), 'b is in sync')

    b$(4)
    await new Promise( Y => setTimeout(Y, 30) )

    t.equals(
        Object.values(computations).join('|'),
        [2, 2, 3, 2 -1, 1 + 1 -1, 3, 3].map( x => x + 1).join('|'),
        'b listener ran, and all the other listeners except a listener ran'
    )

    t.end()
})

test('cancelled generators run clean up', async t => {
    let a$ = S.data(1)
    let b$ = S.data(2)

    let cleanups = {
        first: 0,
        middle: 0,
        final: 0
    }

    S.root(() => {
        S.generator<number>(function * (){ 
            let a = a$()
    
            S.cleanup(() => {
                cleanups.first++
            })
            
            yield new Promise( Y => setTimeout(Y, 10) )
    
            S.cleanup(() => {
                cleanups.middle++
            })
            
            let b = b$()
    
            yield new Promise( Y => setTimeout(Y, 10) )
    
            S.cleanup(() => {
                cleanups.final++
            })
    
            return a + b
        })
    })

    await new Promise( Y => setTimeout(Y, 30) )

    t.equals(
        Object.values(cleanups).join('|'), '0|0|0', 'no clean ups run first time'
    )

    b$(x => x + 1)

    await new Promise( Y => setTimeout(Y, 30) )

    t.equals(
        Object.values(cleanups).join('|'), '1|1|1', 'clean ups run on write'
    )

    b$(x => x + 1)

    await new Promise( Y => setTimeout(Y, 10) )

    t.equals(
        Object.values(cleanups).join('|'), '2|2|2', 'clean ups run on 2nd write'
    )

    b$(x => x + 1)

    await new Promise( Y => setTimeout(Y, 0) )

    t.equals(
        Object.values(cleanups).join('|'), '3|3|2', 'only registered cleanups run if cancelled early'
    )

    t.end()
});

test('multi root disposal', t => {
    let a = S.data(1)
    let b = S.data(2)
    let disposers : Record<string, VoidFunction>= {}
    let cleanups = {
        outerA: 0,
        outerB: 0,
        innerA: 0,
        innerB: 0
    }
    let computations = {
        outerA: 0,
        outerB: 0,
        innerA: 0,
        innerB: 0
    }

    S.root(dispose => {
        disposers.outer = dispose

        
        S.root(dispose => {
            S.computation(() => {
                S.cleanup( () => {
                    cleanups.innerA++
                })

                computations.innerA++
                a()
            })
            disposers.a = dispose
        })
        S.root(dispose => {
            S.computation(() => {
                S.cleanup(() => {
                    cleanups.innerB++
                })
                computations.innerB++
                b()
            })
            disposers.b = dispose
        })

        S.computation(() => {
            S.cleanup(() => {
                cleanups.outerA++
            })
            computations.outerA++
            a()
        })

        S.computation(() => {
            S.cleanup(() => {
                cleanups.outerB++
            })
            computations.outerB++
            b()
        })
    })

    t.equals(
        Object.values(computations).join('|'), '1|1|1|1', 'initial computation'
    )
    t.equals(
        Object.values(cleanups).join('|'), '0|0|0|0', 'no clean ups yet'
    )

    a(3)

    t.equals(
        Object.values(computations).join('|'), '2|1|2|1', 'a updated computation'
    )

    b(5)

    t.equals(
        Object.values(computations).join('|'), '2|2|2|2', 'b updated computation'
    )

    t.equals(
        Object.values(cleanups).join('|'), '1|1|1|1', 'all cleaned up once'
    )

    disposers.outer()

    t.equals(
        Object.values(cleanups).join('|'), '2|2|1|1', 'outer dispose triggered outer clean ups'
    )

    a(7)

    t.equals(
        Object.values(computations).join('|'),
        '2|2|3|2',
        'only inner A updated as outer A was disposed'
    )

    b(9)

    t.equals(
        Object.values(computations).join('|'),
        '2|2|3|3',
        'only inner B updated as outer B was disposed'
    )

    t.equals(
        Object.values(cleanups).join('|'), '2|2|2|2', 'inner clean ups caught up'
    )

    S.freeze(() => {
        a(11);
        b(13);
    })

    t.equals(
        Object.values(computations).join('|'),
        '2|2|4|4',
        'the inners ran, the outers did not as they are disposed'
    )

    t.equals(
        Object.values(cleanups).join('|'), '2|2|3|3'
        , 'inners cleaned up again, outers did not'
    )

    disposers.a()
    disposers.b()

    t.equals(
        Object.values(cleanups).join('|'), '2|2|4|4'
        , 'inners cleaned up again, outers did not'
    )

    t.equals(
        Object.values(computations).join('|'),
        '2|2|4|4',
        'disposal did not trigger computations'
    )

    S.freeze(() => {
        a(15);
        b(17);
    })
    t.equals(
        Object.values(cleanups).join('|'), '2|2|4|4'
        , 'all disposed so no new cleanups'
    )

    t.equals(
        Object.values(computations).join('|'),
        '2|2|4|4',
        'all disposed so no new computations'
    )

    t.end()
})

test('log example', t => {

    let log = {
        foo: 0,
        bar: 0,
        bleck: 0,
    }
    const isLogging = S.data(true);
    const foo = S.data(0)
    const bar = S.data(0)
    const bleck = S.data(0)

    S.root(() => {
        S.computation(() => {
            if (isLogging()) {
                S.computation(() => {log.foo++; foo(); });
                S.computation(() => {log.bar++; bar(); });
                S.computation(() => {log.bleck++; bleck; });
            }
        });
    })

    t.deepEquals(log, { foo: 1, bar: 1, bleck: 1 }, 'first run')

    bar(2)

    t.deepEquals(log, { foo: 1, bar: 2, bleck: 1 }, 'bar updated')

    isLogging(false)

    t.deepEquals(log, { foo: 1, bar: 2, bleck: 1 }, 'no updates as logging false')

    foo(x => x + 1)
    bar(x => x + 1 )
    bleck( x => x + 1 )

    t.deepEquals(log, { foo: 1, bar: 2, bleck: 1 }, 'no updates as logging false')

    isLogging(true)

    t.deepEquals(log, { foo: 2, bar: 3, bleck: 2 }, 'first run after updating isLogging')

    t.end()
})