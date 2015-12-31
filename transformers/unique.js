/**
 * Makes a unique string within a given label
 */

module.exports.transform = function( context, data, label ) {
	context.uniqueLists = context.uniqueLists || {};
	var pool = context.uniqueLists[ label ] = context.uniqueLists[ label ] || {};

	if( !pool[ data ] ) {
		pool[ data ] = 1;
		return data;
	}

	return data + '#' + ( ++pool[ data ] );
};
