var socket,
		socketKey,
		validator;

document.addEventListener( 'DOMContentLoaded', documentReady );

function documentReady(){
	initEventHandlers();
	initConnection();

	if( window.ZSchema ) validator = new ZSchema();
}

function initEventHandlers(){
	return [{
		entity: document.getElementById( 'mapping' ),
		handlers: { change: setConvertLink }
	}, {
		entity: document.querySelector( '#pending-revisions ul' ),
		handlers: {
			click: handleRevisionClick,
			keyup: handleRevisionKeyDown,
			DOMNodeInserted: requestAdded
		}
	}].forEach( bindHandlersForEntity );

	function bindHandlersForEntity( declaration ){
		if( declaration.entity ) Object.keys( declaration.handlers ).forEach( bindEvent );

		function bindEvent( event ){
			declaration.entity.addEventListener( event, declaration.handlers[event] );
		}
	}
}

function setConvertLink(){
	var url = location.href + '/transform/' + document.getElementById( 'mapping' ).value;

	document.getElementById('transform').href = url;
}

function initConnection(){
	if( !window.io ) return;

	socket = io();

	var keyContainer = document.getElementById('socketkey');
	
	socketKey = keyContainer && keyContainer.dataset.socketkey
	
	socket.emit('socketkey', socketKey);

	socket.on('requestedit', createRevisionJob);

	socket.on('remove', removeRevision);
}

var maxRevisionsToShow = 1,
		revisionsBuffer = [],
		revisionItems = {};

function createRevisionJob(data){
	var list = document.querySelector('#pending-revisions ul'),
			item = document.createElement('ul');

	if(list.children.length < maxRevisionsToShow) {
		var revision = new Revision(data);
		item.appendChild(revision.element);
		list.appendChild(item);
	} else {
		revisionsBuffer.push(data);
		setSummary();
	}
}

function setSummary(){
	var summary = document.getElementById('pending-revisions-summary');

	summary.innerHTML = 'and ' + revisionsBuffer.length + ' more';
}

function Revision(data){
	var element = this.element = document.createElement('div'),
			sourceTable = document.createElement('table');

	element.className = 'rectifyform';
	element.dataset.revisionId = data.revisionId;
	
	Object.keys(data.sourceData).forEach(function(key){
		var value = data.sourceData[key],
				tr = document.createElement('tr'),
				td1 = document.createElement('td'),
				td2 = document.createElement('td');

		td1.innerHTML = key;
		td2.innerHTML = value;

		tr.appendChild(td1);
		tr.appendChild(td2);

		sourceTable.appendChild(tr);
	});
	
	element.appendChild(sourceTable);

	data.requiredKeys.forEach(function(key){
		var label = document.createElement('label'),
				input = document.createElement('input'),
				value = data.currentValues[key];
		
		label.innerHTML = key;
		label.appendChild(input);

		input.dataset.key = key;
		input.className = 'entity-field';

		if(value) input.value = value;

		element.appendChild(label);
	});

	var rectifyButton = document.createElement('button');
	rectifyButton.innerHTML = 'rectify';

	element.appendChild(rectifyButton);

	var dismissButton = document.createElement('button');
	dismissButton.className = 'dismiss';
	dismissButton.innerHTML = 'dismiss';

	element.appendChild(dismissButton);

	revisionItems[data.revisionId] = data;
}



function handleRevisionClick(e){
	if(e.target && e.target.tagName.toLowerCase() === 'button'){
		sendRevision( e.target.parentNode, e.target.className );
	}
}

function handleRevisionKeyDown(e){
	if(e.target && e.target.tagName.toLowerCase() === 'input' ) {
		if( e.keyCode === 13 ) sendRevision( e.target.parentNode.parentNode );
		if( e.keyCode === 27 ) sendRevision( e.target.parentNode.parentNode, 'dismiss' );
	}
}

function sendRevision(revisionElement, method){
	var revisionId = revisionElement.dataset.revisionId,
			allChildren = revisionElement.children,
			newData = {};

	if(method === 'dismiss'){
		return socket.emit('dismiss', { socketKey: socketKey, revisionId: revisionId });
	}

	Array.prototype.forEach.call(allChildren, function(child){
		if(child.tagName.toLowerCase() === 'label'){
			var input = child.children[0],
					key = input.dataset.key,
					value = input.value;
			if(value) newData[key] = value;
		}
	});

	var revisionItem = revisionItems[revisionId];

	console.log('isValid', validator.validate(newData, revisionItem.schema));

	socket.emit('rectify', {
		socketKey: socketKey,
		revisionId: revisionId,
		values: newData
	});
}

function removeRevision(revisionId){
	var element = document.querySelector('div[data-revision-id="' + revisionId + '"]');

	if(!element) {
		console.log('element not found: ' + revisionId);
		return;
	}

	var li = element.parentNode,
			ul = li.parentNode;

	li.remove();

	var nextRevisionData = revisionsBuffer.shift();

	if(!nextRevisionData) return; //todo make nicer message
	
	var nextRevision = new Revision(nextRevisionData),
			item = document.createElement('ul');

	item.appendChild(nextRevision.element);

	ul.appendChild(item);
	setSummary();
}

function requestAdded(e){
	var firstEmptyElement;
	Array.prototype.forEach.call(e.target.querySelectorAll('input'), checkIfIsFirstEmptyInput);

	function checkIfIsFirstEmptyInput(element){
		if( !firstEmptyElement && !element.value ) firstEmptyElement = element;
	}

	firstEmptyElement.focus();
}
