import * as S from './index.js'

const useState = S.data;

const DOM = {
    createElement(tag){
        return document.createElement(tag)
    },
    createFragment(){
        return document.createDocumentFragment()
    },
    textNode(content){
        let el = document.createTextNode()
        el.textContent = content
        return el
    },
    updateStyleProperty(el, k, v) {
        el.style.setProperty(k, v)
    },
    setAttribute(el, k, v) {
        el.setAttribute(k, v)
    }
}
const h = (tag, attrs={}, ...children) => {
    let el = DOM.createElement(tag)

    let eventListeners = []
    let styleListeners = []
    let attributeListenrs = []

    for( let [k,v] of attrs ) {
        if ( k.startsWith('on') ) {
            eventListeners.push([k.slice(2), v])
        } else if ( k === 'style' ) {
            let style = v
            for( let [k,v] of Object.entries(style) ) {
                if ( typeof v === 'function' ) {
                    styleListeners.push([k,v])
                } else {
                    DOM.updateStyleProperty(el, k, v)
                }
            }
        } else if ( typeof v === 'function' ) {
            attributeListenrs.push([k,v])
        } else {
            DOM.setAttribute(el, k, v)
        }
    }

    if (children.length == 0) return el

    let fragment = DOM.createFragment()

    let processChild = (child, prevSibling) => {
        if ( child == null ) {
            return child;
        } else if ( ['number','string'].includes(typeof child) ) {
            fragment.appendChild(DOM.textNode(child))
        } else if ( typeof child === 'function' ) {
            S.computation(() => {

                let res = processChild(child())

                if ( prevSibling == null && res == null )
                if ( res === null ) {
                    el.removeChild(prevSibling.nextSibling)
                } else {
                    el.replaceChild(prevSibling.nextSibling, processChild(child))
                }

                processChild(child)
            })
        }
    }

    let prevSibling
    for( let child of children.flat() ) {
        
        processChild(child)
        el.appendChild(child)
    }
}

function * Counter(){

    // aliased S.data to useState for familiarity
    const a = useState(0);
    const b = useState(0);
    const text = useState('')
    const loading = useState(false)

    // useEffect / S.computation / shorthand 
    // is just yielding a generator or a function
    useEffect(() => {
        console.log('a', a())
    })

    // same thing as above
    yield () => {
        console.log('b', b())
    }

    // could also do useAsyncEffect
    let response = yield function * () {
        // this is effectively a debounce
        // each time they type the prev coroutine is cancelled
        // and we then wait 100 before doing anything
        // so we'll only kick off a fetch when they stop typing
        yield new Promise(Y => setTimeout(Y,100) )

        let cancelled = true;
        loading(true)
        try {
            console.log('latest search is', text())
            console.log('fetching...')
    
            yield new Promise(Y => setTimeout(Y, (Math.random() + 0.2) *  1000 ) )

            cancelled = false

            return { status: 200, data: [text] } 
        } finally {
            if ( cancelled ) {
                console.log('fetching', text(), 'cancelled')
            } else {
                console.log('fetching', text(), 'complete')
                loading(false)
            }
        }
    }

    return () => h('div'
        // using range here to prove a point, you can update range.value without
        // any vdom diffing because a is a stream, using range shows how smooth that
        // can be
        , h('input', { type: 'range', value: a, onchange: e => a(e.target.value) })
        , h('input', { type: 'range', value: b, onchange: e => b(e.target.value) })

        // for searching
        , h('input', { type: 'text', value: text, onchange: e => text(e.target.value) })

        // this paragraph updates without any dom diffing
        , h('p', 'Total ', () => a() + b())

        // shows a response or ... if loading, thunk is an inline computation
        , () => loading() ? h('span', '...') : h('pre', response()) 

        , list(xs, x => { xs(); return x.id }, x => {
            return h('li'
                , h('p', h('span', { className: 'title'}, x.title), h('span', { className: 'rank' }, `(${x.rank})`) )
            )
        })
    )

}


// this doesn't make a lot of sense yet, just working through it "out loud"
function list( listComputation, keyFn, domGenerator ){
   
    let fragment = DOM.createFragment()

    let prevDOM = new Map()
    let prevSibling = new Map()
    let data = new Map()

    S.computation(() => {

        // if the list is replaced
        // re-run the loop
        let xs = listComputation()

        let prevKey = null

        for (let x of xs ) {

            
            S.computation(() => {
                
                // compute the key
                // if the key fn is a computation, an emit will
                // re-run this code
                let key = keyFn(x)
    
                data.set(key, x)



                S.computation((prevDOM) => {

                    // compute the view, if that uses computations
                    // that emit, re-compute its position in the dom
                    let dom = domGenerator( data.get(key) ) 
                    
                    prevDOM.set(key, dom)
                    prevSibling.set(key, prevKey)

                    // didn't exist before, and doesn't exist this time
                    // so just return nothing
                    if ( dom === null && prevDOM == null) { return dom; }

                    // did exist, but now doesn't, so remove from page
                    // should also update node that had this node as a prev sibling
                    // to use the prior node instead 
                    if ( dom == null ) {
                        fragment.removeChild(prevDOM)
                        return dom;
                    }

                    // if dom exists, but there's no prevKey, its the first node
                    // so just append
                    if ( prevKey == null ) {
                        fragment.appendChild(dom)
                        return dom;
                    }

                    // ok now we aren't the first sibling and we need to be updated
                    // or inserted for the first time
                    let after = prevDOM.get(prevKey);

                    // if for some reason, our prevSibling is gone, freak out for now
                    if ( after == null ) {
                        throw new Error('Handle where prev sibling was removed later...')
                    } 

                    // if we're at the same position on the page, just swap the child out
                    if ( prevIndex == currentIndex ) {
                        fragment.replaceChild(prevDOM, dom)
                    } else {
                        // otherwise inject / move the sibling to the new position
                        fragment.after(prevSibling)
                    }
                })
            })
            prevKey = key
        }
    })

    return fragment;
}