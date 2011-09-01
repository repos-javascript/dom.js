// TODO:
// 
// Do I need a delete hook? (for boolean attributes?)
// 


/*
 * Attributes in the DOM are tricky:
 * 
 * - there are the 8 basic get/set/has/removeAttribute{NS} methods
 * 
 * - but many HTML attributes are also "reflected" through IDL attributes
 *   which means that they can be queried and set through regular properties
 *   of the element.  There is just one attribute value, but two ways to get
 *   and set it.
 * 
 * - Different HTML element types have different sets of reflected attributes.
 *
 * - attributes can also be queried and set through the .attributes property
 *   of an element.  This property behaves like an array of Attr objects.  The
 *   value property of each Attr is writeable, so this is a third way to 
 *   read and write attributes.
 * 
 * - for efficiency, we really want to store attributes in some kind of
 *   name->attr map.  But the attributes[] array is an array, not a map, which
 *   is kind of unnatural.
 *
 * - When using namespaces and prefixes, and mixing the NS methods with the
 *   non-NS methods, it is apparently actually possible for an attributes[]
 *   array to have more than one attribute with the same qualified name.  And
 *   certain methods must operate on only the first attribute with such a
 *   name.  So for these methods, an inefficient array-like data structure
 *   would be easier to implement. 
 * 
 * - The attributes[] array is live, not a snapshot, so changes to the
 *   attributes must be immediately visible through existing arrays.
 * 
 * - When attributes are queried and set through IDL properties (instead of
 *   the get/setAttributes() method or the attributes[] array) they may be
 *   subject to type conversions, URL normalization, etc., so some extra
 *   processing is required in that case.
 * 
 * - But access through IDL properties is probably the most common case, so
 *   we'd like that to be the fast path.  That means that we'll have to do the
 *   type conversions on the other, slower, access paths.
 * 
 *    But we have to retain the raw value of the content attribute, even
 *    when it does not convert correctly. It isn't worth storing parsed
 *    and unparsed representations, at least not for most attributes, so
 *    I think I'll need to store all values as content strings and do
 *    the conversions each time the idl attribute is queried or set.
 *    So much for the fast path.
 * 
 * - We need to be able to send change notifications or mutation events of
 *   some sort to the renderer whenever an attribute value changes, regardless
 *   of the way in which it changes.
 * 
 * - Some attributes, such as id and class affect other parts of the DOM API, 
 *   like getElementById and getElementsByClassName and so for efficiency, we
 *   need to specially track changes to these special attributes.
 * 
 * - Some attributes like class have different names (className) when
 *   reflected. 
 * 
 * - Attributes whose names begin with the string "data-" are treated specially.
 * 
 * - Reflected attributes that have a boolean type in IDL have special
 *   behavior: setting them to false (in IDL) is the same as removing them
 *   with removeAttribute()
 * 
 * - numeric attributes (like HTMLElement.tabIndex) can have default values
 *    that must be returned by the idl getter even if the content attribute
 *    does not exist. (The default tabIndex value actually varies based on 
 *    the type of the element, so that is a tricky one).
 *
 * This Attributes class attempts to deal with all of these issues. 
 * Each element will have a single instance of this class.  The getters and
 * setters for its idl attribute properties will call methods on that
 * attributes object.  The get/set/has/removeAttribute{NS}() methods will all
 * call methods on the attributes object.  And there will be a proxy handler
 * that can be used when wrapping the element so that the attributes object
 * behaves like an Attr[].
 *
 *   I could save a level of indirection if I put all the methods back
 *   directly on element. Since each element always has exactly one
 *   set of attributes, I could move all of the Attributes class back
 *   into Element.  The attributes property would have to return a dummy object
 *   with a different _idlName so that it wraps properly, but that seems doable.
 *
 * In order to make this work, Element and each of its subtypes must declare
 * the set of reflected attributes that they define.  So each element type
 * should have an _attrDecls property on its prototype. This
 * property refers to an object that maps attribute names to attribute
 * declaration objects that  describe "reflected" attributes and the special
 * handling they require.
 *
 *    Rather than setting up this set of declarations explicitly, 
 *    Classes will call reflectAttribute() (maybe reflectBooleanAttribute) 
 *    etc. and that will take care of it.
 *    Note that attribute declarations can be useful for attributes that
 *    require an onchange hook even if the attribute is not reflected.
 *
 * An attribute declaration object may have the following properties:
 * 
 *   onchange: a function to be invoked when the value of the attribute changes.
 *     for the id attribute, for example, this function would update the
 *     id->elt map for the document.
 * 
 *   idlToContent: a conversion function to convert the idl attribute
 *     value to a string content attribute.  If undefined then
 *     no conversion is necessary.
 *
 *   contentToIDL: a conversion function to convert from a string
 *     content attribute value to the appropriate idl attribute type.
 *     The conversion may not be a type conversion: url properties,
 *     e.g. require some normalization but remain strings. 
 *     undefined if no conversion is needed.
 * 
 *   idlname:  the name of the property that holds the idl attribute
 *      this is usually the same as the content attribute name, but
 *      is different for class/className, for example
 *
 *   boolean: true if this is a boolean attribute and undefined
 *      otherwise.  boolean attributes have special behavior: setting
 *      their IDL value to false is like calling removeAttribute() on them.
 * 
 *   legalValues: an set of legal values for enumerated attributes that
 *      the html spec says are "limited to only known values". HTMLElement.dir
 *      is an example.  If you specify this attribute, appropriate 
 *      idlToContent and contentToIDL conversion functions will be created,
 *      so don't specify both this and those conversion functions. The
 *      value of this property should be an object that maps lowercase
 *      versions of all legal values to the canonical value that they
 *      should convert to.  Note that attributes that set this
 *      property will probably always also have to set storeAsContent
 *
 *   storeAsContent: set this to true to indicate that the content
 *      value of the attribute is what should be stored in the Attr
 *      object. The default is to store the idl version of the value.
 *      But some attributes (like HTMLElement.dir) need to retain the
 *      exact content value and cannot regenerate it from the idl value.
 * 
 *     XXX: actually, I think all attributes will be store as content
 *      If everything is stored as content, then I think I can
 *      simplify the Attr class again so it only has value
 *      getter/setter, and not the idlvalue accessor pair anymore.
 *      Then the conversion stuff would be pushed off onto the
 *      automatically-generated idl attribute getter/setter pairs.
 * 
 * XXX: For enumerated attributes (such as dir) is it useful to declare
 *   the complete set of legal values here?
 * 
 * See
 * http://www.whatwg.org/specs/web-apps/current-work/multipage/urls.html#reflect
 * for rules on how attributes are reflected.
 *
 * Notice that the simplest string-valued reflected attributes do not
 * require any of the properties listed above so an empty object (or null?)
 * or some constant value will work for them.
 * 
 * XXX: I don't know yet if these can just be plain JS objects created with
 *  object literals, or whether it will be useful to define a factory method
 *  or even an AttrDecl class with methods in it.
 *
 * IMPL NOTES:
 *
 * I think each Attr object I create from here will refer to the 
 * attribute declaration, if there is one, and it is the value property
 * of the attr that will do the interesting setter stuff in one location.
 * 
 * For the NS versions I have to find attributes by ns/lname. For the non-NS
 * methods, I have to find them by qname.  So I think I need two maps. (Or in
 * the ns case, a ns->{lname->Attr} 2-layer map? (No: probably just append
 * ns string to the lname with some kind of prefix)  In the qname map, I have
 * to be prepared to have more than one Attr that matches, so it maps to an
 * attr or an array of attrs.
 *
 * the byNSAndLName map will work by using ns + "|" + lname as the map key "|"
 * is not legal in a localname, so this should be unique.  If ns is "" or null
 * then we'll use "|" + lname.  (I think that null and "" namespaces should
 * always be treated as equivalent.)
 *
 * I've added storeAsContent to attr declarations. Note, though, that any
 * attribute with conversion functions that can fail from bad input will
 * need to store the content value, because getAttribute() always needs to
 * return whatever was passed to setAttribute(), even when the idl attribute
 * is more selective.  Setting "tabindex" to a non-numeric string won't change
 * the tabIndex idl property, but we've got to remember the non-numeric string.
 * 
 * In reflectAttribute(), can I automatically generate the conversion funcs
 * for other types of attributes, too?  If an attr decl just says that it
 * is of type "long", can I do the right thing automatically?  (If so, then
 * I'd specify type:"boolean" instead of boolean:true in the decl object.)
 */
defineLazyProperty(impl, "Attributes", function() {

    function Attributes(element) {
        this.element = element;  // The element to which these attributes belong
        this.length = 0;         // How many attributes are there?
        this.byQName = Object.create(null);      // The qname->Attr map
        this.byNSAndLName = Object.create(null); // The ns|lname map
        this.keys = [];                          // attr index -> ns|lname
    }

    Attributes.prototype = O.create(Object.prototype, {
        _idlName: constant("AttrArray"),

        item: constant(function item(index) {
            return this.byNSAndLName[this.keys[index]];
        }),

        getAttribute: constant(function getAttribute(qname) {
            if (this.element.isHTML) qname = toLowerCase(qname);
            var attr = this.byQName[qname];
            if (!attr) return null;

            if (isArray(attr))  // If there is more than one
                attr = attr[0];   // use the first

            return attr.value;
        }),

        getAttributeNS: constant(function getAttributeNS(ns, lname) {
            var attr = this.byNSAndLName[ns + "|" + lname];
            return attr ? attr.value : null;
        }),
        
        hasAttribute: constant(function hasAttribute(qname) {
            if (this.element.isHTML) qname = toLowerCase(qname);
            return qname in this.byQName;
        }),

        hasAttributeNS: constant(function hasAttributeNS(ns, lname) {
            var key = ns + "|" + lname;
            return key in this.byNSAndLName;
        }),

        setAttribute: constant(function setAttribute(qname, value) {
            if (!isValidName(qname)) InvalidCharacterError();
            if (this.element.isHTML) qname = toLowerCase(qname);
            if (substring(qname, 0, 5) === "xmlns") NamespaceError();

            // XXX: the spec says that this next search should be done 
            // on the local name, but I think that is an error.
            // email pending on www-dom about it.
            var attr = this.byQName[qname];
            if (!attr) {
                attr = this._newAttr(qname);
            }
            else {
                if (isArray(attr)) attr = attr[0];
            }

            // Now set the attribute value on the new or existing Attr object.
            // The Attr.value setter method handles mutation events, etc.
            attr.value = value;
        }),
        

        setAttributeNS: constant(function setAttributeNS(ns, qname, value) {
            if (!isValidName(qname)) InvalidCharacterError();
            if (!isValidQName(qname)) NamespaceError();

            let pos = S.indexOf(qname, ":"), prefix, lname;
            if (pos === -1) {
                prefix = null;
                lname = qname;
            }
            else {
                prefix = substring(qname, 0, pos);
                lname = substring(qname, pos+1);
            }

            var key = ns + "|" + lname;
            if (ns === "") ns = null;

            if ((prefix !== null && ns === null) ||
                (prefix === "xml" && ns !== XML_NAMESPACE) ||
                ((qname === "xmlns" || prefix === "xmlns") &&
                 (ns !== XMLNS_NAMESPACE)) ||
                (ns === XMLNS_NAMESPACE && 
                 !(qname === "xmlns" || prefix === "xmlns")))
                NamespaceError();

            var attr = this.byNSAndLName[key];
            if (!attr) {
                var decl = prefix
                    ? null
                    : this.element._attrDecls[lname];
                var attr = new impl.Attr(this.element, decl, lname, prefix, ns);
                this.byNSAndLName[key] = attr;
                this.keys = O.keys(this.byNSAndLName);
                this.length = this.keys.length;

                // We also have to make the attr searchable by qname.
                // But we have to be careful because there may already
                // be an attr with this qname.
                this._addQName(attr);
            }
            else {
                // Calling setAttributeNS() can change the prefix of an 
                // existing attribute!
                if (attr.prefix !== prefix) {
                    // Unbind the old qname
                    this._removeQName(attr);
                    // Update the prefix
                    attr.prefix = prefix;
                    // Bind the new qname
                    this._addQName(attr);
                }
            }
            attr.value = value; // Automatically sends mutation event
        }),

        removeAttribute: constant(function removeAttribute(qname) {
            if (this.element.isHTML) qname = toLowerCase(qname);

            var attr = this.byQName[qname];
            if (!attr) return;

            // If there is more than one match for this qname
            // so don't delete the qname mapping, just remove the first
            // element from it.
            if (isArray(attr)) {
                if (attr.length > 2) {
                    attr = A.shift(attr);  // remove it from the array
                }
                else {
                    this.byQName[qname] = attr[1];
                    attr = attr[0];
                }
            }
            else {
                // only a single match, so remove the qname mapping
                delete this.byQName[qname];
            }

            // Now attr is the removed attribute.  Figure out its
            // ns+lname key and remove it from the other mapping as well.
            var key = (attr.namespaceURI || "") + "|" + attr.localName;
            delete this.byNSAndLName[key];
            this.keys = O.keys(this.byNSAndLName);
            this.length = this.keys.length;

            // Onchange handler for the attribute
            if (attr.declaration && attr.declaration.onchange) 
                attr.declaration.onchange(this.element, this.localName,
                                          this.idlvalue, null);

            // Mutation event
            if (this.element.rooted)
                this.element.ownerDocument.mutateRemoveAttr(attr);
        }),

        removeAttributeNS: constant(function removeAttributeNS(ns, lname) {
            var key = (ns || "") + "|" + lname;
            var attr = this.byNSAndLName[key];
            if (!attr) return;

            delete this.byNSAndLName[key];
            this.keys = O.keys(this.byNSAndLName);
            this.length = this.keys.length;

            // Now find the same Attr object in the qname mapping and remove it
            // But be careful because there may be more than one match.
            this._removeQName(attr);

            // Onchange handler for the attribute
            if (attr.declaration && attr.declaration.onchange) 
                attr.declaration.onchange(this.element, this.localName,
                                          this.idlvalue, null);
            // Mutation event
            if (this.element.rooted)
                this.element.ownerDocument.mutateRemoveAttr(attr);
        }),

        // This "raw" version of getAttribute is used by the getter functions
        // of reflected idl attributes. 
        // This is the fast path for reading the idl value of reflected attrs.
        get: constant(function get(qname) {
            // We assume that qname is already lowercased, so we don't 
            // do it here.
            var attr = this.byQName[qname];  
            if (!attr) return "";  // Non-existant attributes reflect as ""

            // We don't check whether attr is an array.  A qname with no
            // prefix will never have two matching Attr objects (because
            // setAttributeNS doesn't allow a non-null namespace with a 
            // null prefix.

            return attr.idlvalue;   // The raw value
        }),

        // The raw version of setAttribute for reflected idl attributes.
        // Assumes the value is in already converted form, so skips 
        // the conversion step that setAttribute does.
        set: constant(function set(qname, value) {
            var attr = this.byQName[qname];  
            if (!attr) attr = this._newAttr(qname);
            attr.idlvalue = value;
        }),

        // Create a new Attr object, insert it, and return it.
        // Used by setAttribute() and by set()
        _newAttr: constant(function _newAttr(qname) {
            var attr = new impl.Attr(this.element,
                                     this.element._attrDecls[qname],
                                     qname);
            this.byQName[qname] = attr;
            this.byNSAndLName["|" + qname] = attr;
            this.keys = O.keys(this.byNSAndLName);
            this.length = this.keys.length;
            return attr;
        }),

        // Add a qname->Attr mapping to the byQName object, taking into 
        // account that there may be more than one attr object with the 
        // same qname
        _addQName: constant(function(attr) {
            var qname = attr.name;
            var existing = this.byQName[qname];
            if (!existing) {
                this.byQName[qname] = attr;
            }
            else if (isArray(existing)) {
                push(existing, attr);
            }
            else {
                this.byQName[qname] = [existing, attr];
            }
        }),

        // Remove a qname->Attr mapping to the byQName object, taking into 
        // account that there may be more than one attr object with the 
        // same qname
        _removeQName: constant(function(attr) {
            var qname = attr.name;
            var target = this.byQName[qname];

            if (isArray(target)) {
                var idx = A.indexOf(target, attr);
                assert(idx !== -1); // It must be here somewhere
                if (target.length === 2) {
                    this.byQName[qname] = target[1-idx];
                }
                else {
                    splice(target, idx, 1)
                }
            }
            else {
                assert(target === attr);  // If only one, it must match
                delete this.byQName[qname];
            }
        }),
    });

    return Attributes;
});

defineLazyProperty(impl, "Attr", function() {
    function Attr(elt, decl, lname, prefix, namespace) {
        // Always remember what element we're associated with.
        // We need this to property handle mutations
        this.ownerElement = elt;

        // If the attribute requires special onchange behavior (even
        // if it is not a reflected attribute) this declaration object
        // specifies the onchange hook to call.
        this.declaration = decl;

        // localName and namespace are constant for any attr object.
        // But value may change.  And so can prefix, and so, therefore can name.
        this.localName = lname;
        this.prefix = prefix || null;
        this.namespaceURI = namespace || null;
    }

    Attr.prototype = O.create(Object.prototype, {
        _idlName: constant("Attr"),
        name: attribute(function() {
            return this.prefix
                ? this.prefix + ":" + this.localName
                : this.localName;
        }),
        // Query and set the content attribute value
        value: attribute(
            function() {
                return this.data;
            },
            function(v) {
                if (this.data === v) return;
                let oldval = this.data;
                this.data = v;
                
                // Run the onchange hook for the attribute
                // if there is one.
                if (this.declaration &&
                    this.declaration.onchange)
                    this.declaration.onchange(this.ownerElement,
                                              this.localName,
                                              oldval, v);
                
                // Generate a mutation event if the element is rooted
                if (this.ownerElement.rooted)
                    this.ownerElement.ownerDocument.mutateAttr(
                        this,
                        oldval);
            }
        ), 
    });

    return Attr;
});

// Many reflected attributes do not need to specify anything in their
// attribute declaration object.  So we can just reuse this object for them all
const SimpleAttributeDeclaration = {};

// This is a utility function for setting up reflected attributes.
// Pass an element impl class like impl.HTMLElement as the first
// argument.  Pass the content attribute name as the second
// argument. And pass an attribute declaration object as the third.
// The method adds the attribute declaration to the class c's
// _attrDecls object.  And it sets up getter and setter methods for
// the reflected attribute on the element class's prototype
// If the declaration includes a legalValues property, then this method
// adds appopriate conversion functions to it.
function reflectAttribute(c, name, declaration) {
    var p = c.prototype;
    if (!declaration) declaration = SimpleAttributeDeclaration;
    
    // If p does not already have its own _attrDecls then create one
    // for it, inheriting from the inherited _attrDecls. At the top
    // (for the impl.Element class) the _attrDecls object will be
    // created with a null prototype.
    if (!hasOwnProperty(p, "_attrDecls")) {
        p._attrDecls =
            Object.create(p._attrDecls || null);
    }

    // I don't think we should ever override a reflected attribute of
    // a superclass.
    assert(!(name in p._attrDecls), "Redeclared attribute " + name);

    // See if we need to fix up the declaration object at all.
    if (declaration.legalValues) {
        // Don't specify both conversions and legal values
        assert(!declaration.contentToIDL && !declaration.idlToContent);
        
        // Note that we only have to convert in one direction.
        // Any value set on the idl attribute will become the value of
        // the content attribute.  But content attributes get filtered
        // so that only canonical legal ones are reflected
        // XXX: if an attribute declares an invalid value default or a 
        // missing value default, we may need to use them here...
        declaration.contentToIDL = function(v) {
            return declaration.legalValues[v.toLowerCase()] || "";
        }
    }


    // Add the attribute declaration to the _attrDecls object
    p._attrDecls[name] = declaration;

    var getter, setter;
    if (declaration.contentToIDL) 
        getter = function() {
            return declaration.contentToIDL(this.getAttribute(name));
        };
    else
        getter = function() { return this.getAttribute(name) || ""; }

    if (declaration.idlToContent) 
        setter = function(v) {
            this.setAttribute(name, declaration.idlToContent(v));
        }
    else 
        setter = function(v) { this.setAttribute(name, v); }

    // Now create the accessor property for the reflected attribute
    O.defineProperty(p, declaration.idlname || name, {
        get: getter,
        set: setter
    });
}