var ResultCode = require('../resultCode');

var organisations = {
	PVDA: '/pvda.nl',
	CDA: '/cda.nl'
};

//match to an existing organisation 
//only matches hardcoded two organisations for now
exports.transform = function (context, data) {
	if(!organisations[data]){
		return { resultcode: ResultCode.FAIL };
	}

	return {
		value: organisations[data],
		resultcode: ResultCode.OK
	};
};
