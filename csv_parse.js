var _ = require('underscore'),
	async = require('async');

var delimiters = [',', '.', ':', ';', '|', '$', '/', '\\', '-', '_', '`', '~', '\'', '"'];

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

function smartParse( csvData, header ){
	var lines = csvData.split('\n'),
			delimiter;

	header = header || lines.shift();
	
	delimiter = getDelimiter(header);
	header = header.split( delimiter );

	var objects = [],
			byKey = {};

	lines.forEach(parseAndStow);

	return {
		objects: objects,
		byKey: byKey,
		delimiter: delimiter
	};

	function parseAndStow( line ){
		if(line === ''){
			return;
		}

		var values = line.split(delimiter),
			lineObject = {};

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


module.exports = smartParse;
