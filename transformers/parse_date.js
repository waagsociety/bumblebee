//parse a date value 
exports.transform = function (context, data) {
	var date = new Date(data);
	if(date.toString() === 'Invalid Date'){
		return new Error('parse_date: could not parse as date, data: ' + JSON.stringify( data ) );
	}
	return date;
};
