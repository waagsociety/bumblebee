//match to an existing organisation 
//only matches hardcoded two organisations for now
exports.transform = function (context, data) {
	if(data == 'PVDA')
	{
		return "/pvda.nl";
	}

	if(data == "CDA")
	{
		return "/cda.nl"
	}

	return undefined;
};
