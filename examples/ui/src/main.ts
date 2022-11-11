import * as S from '../../../lib/index.js'

type Attrs = Record<string, any>

type Child = null | number | string | Node | ((el: Node) => Child)
type Children = 
  Child[] 
  | Child[][]

function h(tag: string, attrs: Attrs , ...children: Children ){

  let el = document.createElement(tag)

  for( let [k,v] of Object.entries(attrs) ) {
    let vIsFunc = typeof v === 'function'

    if ( (k === 'class' || k === 'className') ) {
      if (vIsFunc) {
        S.computation(() => {
          el.className = v()
        })
      } else {
        el.className = v
      }
    } else if ( k.startsWith('on') ) {
      el.addEventListener(k.slice(2), v)
    }
  }

  const xs = children.flat()

  function process(x: Child): Node | null {
    if ( typeof x === 'string' || typeof x === 'number' ) {
      let textNode = document.createTextNode(x+'')
      return textNode
    } else if ( typeof x === 'function' ) {
      let f = x
      S.computation<Node | null>((prev) => {
        let node = process(f(el))
        if (prev && node) {
          el.replaceChild(node, prev)
          return node
        } else if (!prev && node) {
          el.appendChild(node)
          return node
        } else if (prev && !node) {
          el.removeChild(prev)
          return null
        }
        return node
      }, null)
      return null
    } else {
      return x
    }
  }

  for ( let x of xs ) {
    let node = process(x)
    if (node) {
      el.appendChild(node)
    }
  }

  return el
}

function css(strings: TemplateStringsArray, ...args: string[]) {
  return (el: Node) => {
    (el as HTMLElement).style.cssText = String.raw({ raw: strings }, ...args)
    return null as Child
  }
}

function Component(){
  let name = S.data('world')

  let animals = S.data([
    { id: 'dog', text: 'Dog', rating: 1 },
    { id: 'cat', text: 'Cat', rating: 1 },
    { id: 'bird', text: 'Bird', rating: 1 }
  ])

  // setInterval(() => {
  //   name( x => x + '!')
  // }, 1000)
  return h('div', { class: 'app' }
    , h('p', {}, 'Hello ', () => name())
    , h('ul'
      , {}
      , animals().map( 
        x => h('li'
          , { key: x.id }
          , css`
            display: grid;
            grid-auto-flow: column;
            justify-content: start;
            gap: 1em;
          `
          , h('div'
            , { className: 'text' }
            , x.text
          )
          , h('div'
            , { className: 'rating' }
            , () => {
              let found = animals().find( y => y.id === x.id )

              if (!found) {
                return 0
              } else {
                return found.rating
              }
            }
          )
          , h('button'
            , 
            { className: 'inc', onclick: () => 
              animals( xs => {
                return xs.map( y => 
                  x.id !== y.id 
                    ? y 
                    : ({ ...y, rating: y.rating + 1 }) 
                )
              })
            }
            , '+'
          )
        )
      )
    )
  )
}

S.root(() => {

  let text = S.data('world')

  let root = Component()

  document.getElementById('app')!.appendChild(root)

  // document.body.appendChild()
  // S.computation(() => {
  // })

  Object.assign(window, { text })
})