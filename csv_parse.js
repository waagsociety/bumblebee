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
		header = lines.shift(),
		delimiter = getDelimiter(header);

	header = header.split( delimiter );

	var objects = [],
		byKey = {};

	header.forEach( function( key ){
		byKey[key] = {};
	} );

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
			var key = header[index];

			if(!key) throw('\033[31mkey (' + index + ') not found for \033[33m' + value + '\033[31m on line \033[0m' + ( lines.indexOf( line ) + 1 ) + '\033[31m: \033[33m' + line + '\033[0m' );
			
			lineObject[key] = value;
			byKey[key][value] = lineObject;
		}
	}

}


module.exports = smartParse;