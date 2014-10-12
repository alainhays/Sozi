/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

namespace("sozi.player", function (exports) {
    "use strict";

    // Use left mouse button to drag
    var DRAG_BUTTON = 0;

    // Minimum distance to detect a drag action
    var DRAG_THRESHOLD_PX = 5;

    // Zoom factor for user zoom action (keyboard and mouse wheel)
    var SCALE_FACTOR = 1.05;

    // Rotation step for user rotate action (keyboard and mouse wheel)
    var ROTATE_STEP = 5;

    exports.Viewport = sozi.model.Object.clone({

        presentation: null,
        cameras: {own: []},
        dragHandler: null,
        dragEngHandler: null,
        
        /*
         * Initialize a new viewport for the given SVG root element.
         *
         * Parameters:
         *    - svgRoot: The SVG root element
         *
         * Returns:
         *    - The current viewport.
         */
        init: function (pres) {
            this.presentation = pres;

            // Setup mouse and keyboard event handlers.
            this.dragHandler = this.bind(this.onDrag);
            this.dragEndHandler = this.bind(this.onDragEnd);

            // Setup model event handlers.
            pres.addListener("change:svgRoot", this.onChangeSVGRoot, this);
            pres.layers.addListener("add", this.onAddLayer, this);
            pres.layers.addListener("remove", this.onRemoveLayer, this);
            
            // If the presentation has already been initialized,
            // register its SVG root.
            if (pres.svgRoot) {
                this.onChangeSVGRoot();
            }

            // If the presentation has already been initialized,
            // register its layers.
            pres.layers.forEach(function (layer) {
                this.onAddLayer(pres.layers, layer);
            }, this);

            return this;
        },

        makeUniqueId: function (prefix) {
            var suffix = Math.floor(1000 * (1 + 9 * Math.random()));
            var id;
            do {
                id = prefix + suffix;
                suffix ++;
            } while(this.svgRoot.getElementById(id));
            return id;
        },
        
        onChangeSVGRoot: function () {
            this.svgRoot.addEventListener("mousedown", this.bind(this.onMouseDown), false);
            this.svgRoot.addEventListener("contextmenu", this.bind(this.onContextMenu), false);
            
            var wheelEvent =
                "onwheel" in document.createElement("div") ? "wheel" :  // Modern browsers support "wheel"
                document.onmousewheel !== undefined ? "mousewheel" :    // Webkit and IE support at least "mousewheel"
                "DOMMouseScroll";                                       // Firefox < 17
            this.svgRoot.addEventListener(wheelEvent, this.bind(this.onWheel), false);

            this.resize();
        },
        
        onAddLayer: function (collection, layer) {
            this.cameras.push(exports.Camera.clone().init(this, layer));
            this.resize();
        },
        
        onRemoveLayer: function (collection, layer) {
            this.cameras.forEach(function (camera) {
                if (camera.layer === layer) {
                    this.cameras.remove(camera);
                }
            }, this);
            this.resize();
        },
        
        get svgRoot() {
            return this.presentation.svgRoot;
        },

        getLayer: function (nodeId) {
            return this.layers.filter(function (layer) {
                return layer.nodeId === nodeId;
            })[0];
        },

        onContextMenu: function (evt) {
            evt.stopPropagation();
            evt.preventDefault();
            this.fire("click", 2);
        },

        /*
         * Event handler: mouse down.
         *
         * If the mouse button pressed is the left button,
         * this method will setup event listeners for detecting a drag action.
         *
         * Parameters:
         *    - evt: The DOM event object
         *
         * Fires:
         *    - mouseDown(button)
         */
        onMouseDown: function (evt) {
            evt.stopPropagation();
            evt.preventDefault();

            if (evt.button === DRAG_BUTTON) {

                this.mouseDragged = false;
                this.mouseLastX = evt.clientX;
                this.mouseLastY = evt.clientY;

                document.documentElement.addEventListener("mousemove", this.dragHandler, false);
                document.documentElement.addEventListener("mouseup", this.dragEndHandler, false);
            }

            this.fire("mouseDown", evt.button);
        },

        /*
         * Event handler: mouse move after mouse down.
         *
         * Parameters:
         *    - evt: The DOM event object
         *
         * Fires:
         *    - dragStart
         *
         * TODO drag horizontally/vertically when Shift key is pressed
         */
        onDrag: function (evt) {
            evt.stopPropagation();

            // The drag action is confirmed when one of the mouse coordinates
            // has moved past the threshold
            if (!this.mouseDragged && (Math.abs(evt.clientX - this.mouseLastX) > DRAG_THRESHOLD_PX ||
                                       Math.abs(evt.clientY - this.mouseLastY) > DRAG_THRESHOLD_PX)) {
                this.mouseDragged = true;
                this.fire("dragStart");
            }

            if (this.mouseDragged) {
                this.drag(evt.clientX - this.mouseLastX, evt.clientY - this.mouseLastY);
                this.mouseLastX = evt.clientX;
                this.mouseLastY = evt.clientY;
            }
        },

        /*
         * Event handler: mouse up after mouse down.
         *
         * If the mouse has been moved past the drag threshold, this method
         * will fire a "dragEnd" event. Otherwise, it will fire a "click" event.
         *
         * Parameters:
         *    - evt: The DOM event object
         *
         * Fires:
         *    - dragEnd
         *    - click(button)
         */
        onDragEnd: function (evt) {
            evt.stopPropagation();
            evt.preventDefault();

            if (evt.button === DRAG_BUTTON) {
                if (this.mouseDragged) {
                    this.fire("dragEnd");
                    this.fire("userChangeState");
                }
                else {
                    this.fire("click", evt.button);
                }

                document.documentElement.removeEventListener("mousemove", this.dragHandler, false);
                document.documentElement.removeEventListener("mouseup", this.dragEndHandler, false);
            }
            else {
                this.fire("click", evt.button);
            }
        },

        /*
         * Event handler: mouse wheel.
         *
         * The effect of the mouse wheel depends on the state of the Shift key:
         *    - released: zoom in and out,
         *    - pressed: rotate clockwise or counter-clockwise
         *
         * Parameters:
         *    - evt: The DOM event object
         *
         * Fires:
         *    - zoom
         *    - rotate
         */
        onWheel: function (evt) {
            evt.stopPropagation();
            evt.preventDefault();

            var delta = 0;
            if (evt.wheelDelta) {   // "mousewheel" event
                delta = evt.wheelDelta;
            }
            else if (evt.detail) {  // "DOMMouseScroll" event
                delta = -evt.detail;
            }
            else {                  // "wheel" event
                delta = -evt.deltaY;
            }

            if (delta !== 0) {
                if (evt.shiftKey) {
                    // TODO rotate around mouse cursor
                    this.rotate(delta > 0 ? ROTATE_STEP : -ROTATE_STEP);
                }
                else {
                    this.zoom(delta > 0 ? SCALE_FACTOR : 1/SCALE_FACTOR, evt.clientX - this.x, evt.clientY - this.y);
                }
            }
        },

        /*
         * Get the X coordinate of the current viewport in the current browser window.
         *
         * If the SVG is a standalone document, the returned value is 0.
         *
         * Returns:
         *    - The X coordinate of the current viewport.
         */
        get x() {
            return this.svgRoot.getScreenCTM().e;
        },

        /*
         * Get the Y coordinate of the current viewport in the current browser window.
         *
         * If the SVG is a standalone document, the returned value is 0.
         *
         * Returns:
         *    - The Y coordinate of the current viewport.
         */
        get y() {
            return this.svgRoot.getScreenCTM().f;
        },

        /*
         * Get the width of the current viewport.
         *
         * If the SVG is inlined in an HTML document, the returned width
         * includes the padding width of the container.
         *
         * If the SVG is a standalone document, the returned width is the
         * window's inner width.
         *
         * Returns:
         *    - The width of the current viewport.
         */
        get width() {
            return this.svgRoot === document.documentElement ?
                window.innerWidth :
                this.svgRoot.parentNode.clientWidth;
        },

        /*
         * Get the height of the current viewport.
         *
         * If the SVG is inlined in an HTML document, the returned height
         * includes the padding height of the container.
         *
         * If the SVG is a standalone document, the returned height is the
         * window's inner height.
         *
         * Returns:
         *    - The height of the current viewport.
         */
        get height() {
            return this.svgRoot === document.documentElement ?
                window.innerHeight :
                this.svgRoot.parentNode.clientHeight;
        },

        /*
         * Fit the size of the SVG document to its container.
         *
         * Returns:
         *    - The current viewport.
         */
        resize: function () {
            if (!this.svgRoot) {
                return this;
            }
            
            this.svgRoot.setAttribute("width", this.width);
            this.svgRoot.setAttribute("height", this.height);

            this.cameras.forEach(function (camera) {
                camera.update();
            });

            return this;
        },

        /*
         * Set the states of the cameras of the current viewport.
         *
         * Parameters:
         *    - states: An array of camera states
         */
        setAtStates: function (states) {
            states.forEach(function (state, index) {
                this.cameras.at(index).copy(state).update();
            }, this);
        },

        /*
         * Apply an additional translation to the SVG document based on onscreen coordinates.
         *
         * This method delegates to the cameras of the currently selected layers.
         *
         * Parameters:
         *    - deltaX: The horizontal displacement, in pixels
         *    - deltaY: The vertical displacement, in pixels
         *
         * Fires:
         *    - userChangeState
         *
         * Returns:
         *    - The current viewport.
         */
        drag: function (deltaX, deltaY) {
            this.cameras.forEach(function (camera) {
                if (camera.selected) {
                    camera.drag(deltaX, deltaY);
                }
            });
            return this;
        },

        /*
         * Zooms the display with the given factor.
         *
         * The zoom is centered around (x, y) with respect to the center of the display area.
         *
         * This method delegates to the cameras of the currently selected layers.
         *
         * Parameters:
         *    - factor: The zoom factor (relative to the current state of the viewport).
         *    - x, y: The coordinates of the center of the zoom operation.
         *
         * Fires:
         *    - userChangeState
         *
         * Returns:
         *    - The current viewport.
         */
        zoom: function (factor, x, y) {
            this.cameras.forEach(function (camera) {
                if (camera.selected) {
                    camera.zoom(factor, x, y);
                }
            });
            this.fire("userChangeState");
            return this;
        },

        /*
         * Rotate the display with the given angle.
         *
         * The rotation is centered around the center of the display area.
         *
         * This method delegates to the cameras of the currently selected layers.
         *
         * Parameters:
         *    - angle: The rotation angle, in degrees.
         *
         * Returns:
         *    - The current viewport.
         *
         * Fires:
         *    - userChangeState
         */
        rotate: function (angle) {
            this.cameras.forEach(function (camera) {
                if (camera.selected) {
                    camera.rotate(angle);
                }
            });
            this.fire("userChangeState");
            return this;
        }
    });
});