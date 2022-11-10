# Notes

## Conflicts

S.js has a concept of conflicts, if you write two different values to a signal in the same tick, that's considered a bug.

This S.js rewrite respects that, but the store bends the rules because 1 store is 1 signal, and two writes to two different parts of the state tree would technically be a conflict because we're giving the root state tree two new root state references for each immutable update, but for our usage, we're writing to two different sub queries in different parts of the tree, so it would be unintuitive to call that a conflict.

So in the store we ~break~ bend the rule, by setting equality set to always return true for the root store.  This means conflicts will not be detected and you could theoretically write two different values in a single tick and last write wins.

In future we may add conflict detection in the store layer, but for now its an extra level of complexity that would likely hit performance and may not even matter for stores, so we'll wait and see after dog fooding.