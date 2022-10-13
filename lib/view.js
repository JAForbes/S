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
    )

}