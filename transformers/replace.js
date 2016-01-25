module.exports.transform = function( context, data, argument ) {
	var split = argument.split( ',' ),
			pattern = split[ 0 ],
			replaceValue = split[ 1 ];

	return data.split( pattern ).join( replaceValue );
};
