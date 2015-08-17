//match to an existing organisation 
//only matches hardcoded two organisations for now
exports.transform = function (context, data) {
	if(data == 'PVDA')
	{
		return {"flag": Flag.OK, "value" : "/pvda.nl"};
	}

	if(data == "CDA")
	{
		return {"flag": Flag.OK, "value" : "/cda.nl"};
	}

	return {"flag": Flag.Fail, "value" : undefined};
};
