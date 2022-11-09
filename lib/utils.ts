import * as S from './index.js'

export const map = <T,U>(f: ((x:T) => U), computation: S.Computation<T>) => S.computation(() => {
	return f( computation() )
}, f(S.sample(computation)))

export const dropRepeatsWith = <T>(signal: S.Computation<T>, equality: (a: T, b: T) => boolean) => {
	let out = S.data( S.sample(signal) )
	let i = 0
	S.computation<T>((prev) => {
		let next = signal()

		if ( i > 0 && !equality(prev, next) ) {
			out(next)
		}
		i++
		return next
	})
	return out;
}

export const mergeAll = <T>(computations: S.Computation<T>[]) : S.Computation<T[]> => {
	
	let initial = computations.map( x => S.sample(x)! )

	let out = S.computation(() => {
		return computations.map( x => x() )
	}, initial)

	return out
}