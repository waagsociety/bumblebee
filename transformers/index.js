require('fs').readdirSync('transformers').forEach(function(fileName){
	var name = fileName.split('.');
	name.pop();
	name = name.join('.');
	if(name !== 'index'){
		module.exports[name] = require('./' + fileName).transform;
	}
});