module.exports.transform = function( context, data, argument ){
	var string = argument,
			tagRegExpg = /{([^}]+)}/,
			matches,
			key, value;

	if( typeof string !== 'string' ) return new Error( 'format: data passed is no string' );
	
	while( matches = tagRegExpg.exec( string ) ){
		key = matches[ 1 ];
		value = data[ key ];
		if( !value ) return new Error('format: key ' + key + ' not found in data');
		string = string.replace( matches[ 0 ], value );
	}

	return string;
};
