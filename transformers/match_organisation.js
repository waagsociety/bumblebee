var organisations = {
	PVDA: '/pvda.nl',
	CDA: '/cda.nl'
};

//match to an existing organisation 
//only matches hardcoded two organisations for now
exports.transform = function (context, data) {
	if(!organisations[data]){
		return new Error('match_organisation: organisation not found, data: ' + JSON.stringify(data));
	}

	return organisations[data];
};
