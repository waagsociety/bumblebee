var _ = require('underscore'),
		async = require('async'),
		csv = require('csv');

var delimiters = [',', '.', ':', ';', '|', '$', '/', '\\', '-', '_', '`', '~', '\''];

function getDelimiter( line ) {
  return delimiters.map( function( character ) {
    return {
      items: line.split( character ),
      delimiter: character
    };
  } ).sort( function( a, b ) {
    return a.items.length - b.items.length;
  } ).pop().delimiter;
}

function smartParse( csvData, passedHeader, cb ){
	if(typeof passedHeader === 'function' ){
		cb = passedHeader;
		passedHeader = null;
	}

	var header = passedHeader || /[^\n^\r\n]+/.exec( csvData )[0],
			csvDatalines = csvData,
			delimiter;

	delimiter = getDelimiter(header);

	return csv.parse(csvDatalines, { delimiter: delimiter, relax: true }, postParse );

	function postParse( err, lines ) {
		if( err ) return cb( err );

		header = lines.shift();

		var objects = [],
				byKey = {};

		lines.forEach(parseAndStow);

		return cb( null, {
			objects: objects,
			byKey: byKey,
			delimiter: delimiter
		} );

		function parseAndStow( values ){
			if( !values.reduce( function( value, string ){ return value + string.length; }, 0 ) ) return; // skip empty lines

			var lineObject = {};

			values.forEach( stow );

			objects.push( lineObject );

			return;

			function stow( value, index ){
				var key = header[index],
						i;

				if( !key ) {
					i = 1;
					while( ( key = 'unknown-key-' + i ) in lineObject ) ++i;
				}
				
				lineObject[key] = value;
				byKey[ key ] = byKey[ key ] || {};
				byKey[key][value] = lineObject;
			}
		}
	}


}


module.exports = smartParse;
