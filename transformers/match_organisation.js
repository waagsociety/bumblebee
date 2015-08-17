//match to an existing organisation 
//only matches hardcoded two organisations for now
exports.transform = function (context, data) {
	if(data == 'PVDA')
	{
		return {"resultcode": ResultCode.OK, "value" : "/pvda.nl"};
	}

	if(data == "CDA")
	{
		return {"resultcode": ResultCode.OK, "value" : "/cda.nl"};
	}

	return {"resultcode": ResultCode.Fail, "value" : undefined};
};
