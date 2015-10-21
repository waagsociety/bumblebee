var socket,
		socketKey;

document.addEventListener( 'DOMContentLoaded', documentReady );

function documentReady(){
	initEventHandlers();
	initConnection();

	if( window.ZSchema ) validator = new ZSchema();
}

var boundDelegates = {},
		eventHandlers = {
			'#mapping': { change: setConvertLink }
		};

function initEventHandlers(){
	Object.keys( eventHandlers ).forEach( bindHandlersForElement );

	function bindHandlersForElement( selector ){
		var handlers = eventHandlers[selector],
				element = document.querySelector( selector );
		if( element ) Object.keys( handlers ).forEach( bindEvent );
		else Object.keys( handlers ).forEach( bindDelegate );

		function bindEvent( eventName ){
			element.addEventListener( eventName, handlers[eventName] );
		}

		function bindDelegate( eventName ){
			if( !boundDelegates[eventName] ) {
				boundDelegates[eventName] = {};
				document.addEventListener( eventName, createDelegateHandler( eventName ) );
			}
			boundDelegates[ eventName ][ selector] = handlers[eventName];
		}
	}

	function createDelegateHandler( eventName ) {
		return function delegateEvent(e){
			var delegates = boundDelegates[eventName],
					target = e.target,
					result = true, didAnyCancel;

			while( target && result ){
				didAnyCancel = Object.keys( delegates ).map( evaluateHandler );
				result = !~didAnyCancel.indexOf(false);

				target = target.parentNode;
			}

			function evaluateHandler( selector ){
				if( target.matches && target.matches( selector ) ) return delegates[selector].call( target, e );
			}
		}
	}
}

function initConnection(){
	if( !window.io ) return;

	socket = io();

	var keyContainer = document.getElementById('socketkey');
	
	socketKey = keyContainer && keyContainer.dataset.socketkey;
	
	socket.emit('socketkey', socketKey);

	socket.on('requestedit', createRevisionJob);

	socket.on('remove', removeRevision);

	socket.on('complete', handleComplete);
}

function setConvertLink(){
	var url = location.href + '/transform/' + document.getElementById( 'mapping' ).value;
	document.getElementById('transform').removeAttribute("disabled");
	document.getElementById('transform').href = url;
}
