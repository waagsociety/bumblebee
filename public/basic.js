
document.addEventListener('DOMContentLoaded', documentReady);

function documentReady(){
	initEventHandlers();
}

function initEventHandlers(){
	return [{
		entity: document.getElementById('quickconvert'),
		handlers: { click: quickConvert }
	}].forEach(bindHandlersForEntity);

	function bindHandlersForEntity(declaration){
		if(declaration.entity) Object.keys( declaration.handlers ).forEach( bindEvent );

		function bindEvent(event){
			declaration.entity.addEventListener( event, declaration.handlers[event] );
		}
	}
}

function quickConvert(){
	var url = location.href + '/quickconvert/' + document.getElementById('mapping').value;
	console.log(url);
	return ajaxRequest(url, {}, updateInfo);

	function updateInfo(results){
		results = JSON.parse(results);

		var allItems = document.createElement('ul');
		allItems.id = 'quick-convert-output';

		results.forEach(function(item){
			var itemElement = document.createElement('li'),
					properties = document.createElement('ul');
			itemElement.appendChild(properties);

			Object.keys(item).forEach(function(key){
				var propertyElement = document.createElement('li'),
						value = item[key][key];

				if(!(parseInt(value) < Infinity) && new Date(value).toString() !== 'Invalid Date') value = new Date(value).toString(0, 21);
				propertyElement.innerHTML = key + ': ' + value;

				properties.appendChild(propertyElement);
			});

			allItems.appendChild(itemElement);
		});

		document.body.appendChild(allItems);
	}
}