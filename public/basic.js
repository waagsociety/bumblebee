var socket,
    socketKey;

function createObjectIterator( method ) {
  return function( fun ) {
    var self = this;

    return Object.keys( self )[ method ]( iterate );

    function iterate( key ) {
      return fun( key, self[ key ], self );
    }
  };
}

Object.prototype.forEach = createObjectIterator( 'forEach' );
Object.prototype.map = createObjectIterator( 'map' );
Object.prototype.filter = createObjectIterator( 'filter' );

document.addEventListener( 'DOMContentLoaded', documentReady );

function documentReady(){
  initEventHandlers();
  window.initConnection && initConnection();

  if( window.ZSchema ) validator = new ZSchema({
    noEmptyStrings: true
  });
}

var boundDelegates = {},
    eventHandlers = {};

function initEventHandlers(){
  Object.keys( eventHandlers ).forEach( bindHandlersForElement );

  function bindHandlersForElement( nodeSelector ){
    var handlers = eventHandlers[nodeSelector],
        element = nodeSelector instanceof Element ? nodeSelector : document.querySelector( nodeSelector ) ;
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
      boundDelegates[ eventName ][ nodeSelector] = handlers[eventName];
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

      function evaluateHandler( nodeSelector ){
        if( target.matches && target.matches( nodeSelector ) ) return delegates[nodeSelector].call( target, e );
      }
    }
  }
}

function resolveOnObject(object, path, value){
  var parts = path.split( '.' ),
      ref = object,
      part;

  while( parts.length > 1 && ref){
    part = parts.shift();
    ref = ref[part];
  }

  if(!ref) throw('declareOnObject: object does not contain ' + part + ', full path given: ' + path);

  part = parts.shift();

  if(value !== undefined) ref[part] = value;
  
  return ref[part];
}

