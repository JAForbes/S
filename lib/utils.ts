import * as S from './index.js'

export const map = <T,U>(f: ((x:T) => U), computation: S.Computation<T>) => S.computation(() => {
	return f( computation() )
}, f(S.sample(computation)))

export const dropRepeatsWith = <T>(signal: S.Computation<T>, equality: (a: T, b: T) => boolean) => {
	
	let i = 0;
	return S.computation<T>((prev) => {
		i++
		let next = signal()

		if ( i === 1  && !equality(prev, next) ) {
			return next
		} else {
			return S.SKIP as T
		}
	}, S.sample(signal))
}

export const mergeAll = <T>(computations: S.Computation<T>[]) : S.Computation<T[]> => {
	
	let initial = computations.map( x => S.sample(x)! )

	let out = S.computation(() => {
		return computations.map( x => x() )
	}, initial)

	return out
}