module.exports.transform = function( context, data, argument ) {
	if( typeof argument === 'function' ) return new Error( 'invoke: no method passed' );
	var split = argument.split( ',' ),
			method = split.shift();

	if( !method ) return new Error( 'invoke: no method passed' );
	if( !data[ method ] || typeof data[ method ] !== 'function' ) return new Error( 'invoke: method not found on data, method: ' + method + ', data: ' + data );
	return data[ method ].apply( data, split );
};
