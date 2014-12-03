/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

window.addEventListener("load", function () {
    "use strict";

    var presentation = sozi.model.Presentation;
    var selection = sozi.editor.model.Selection.init(presentation);
    var viewport = sozi.player.Viewport.init(presentation);

    var controller = sozi.editor.Controller.init(presentation, selection, viewport);

    sozi.editor.view.Preview.init(presentation, selection, viewport, controller);
    sozi.editor.view.Properties.init(presentation, selection, controller);
    var timeline = sozi.editor.view.Timeline.init(presentation, selection, controller);

    // The objects that contain the presentation data and
    // the editor state that need to be saved.
    var jsonSources = [presentation, selection, timeline];

    var svgData;

    /*
     * Create an SVG DOM tree from the given textual data
     * and add it to the editor "preview" area.
     *
     * Return a copy of the DOM tree, null if the given data
     * is not a valid SVG document.
     */
    function loadSVG(data) {
        // Create a DOM tree from the given textual data
        var div = document.createElement("div");
        div.innerHTML = data;

        // Check that the root of is an SVG element
        var svgRoot = div.firstElementChild;
        if (!(svgRoot instanceof SVGSVGElement)) {
            $.notify("Document is not valid SVG.", "error");
            return null;
        }

        // Remove any existing script inside the SVG DOM tree
        var scripts = Array.prototype.slice.call(svgRoot.getElementsByTagName("script"));
        scripts.forEach(function (script) {
            script.parentNode.removeChild(script);
        });

        svgData = div.innerHTML;

        // TODO Transform xlink:href attributes to replace relative URLs with absolute URLs

        // Add the SVG root to the editor view
        $("#sozi-editor-view-preview").html(svgRoot);
        presentation.init(svgRoot);
        viewport.onLoad();
        $("html head title").text(presentation.title);
    }

    /*
     * Open the JSON file with the given name at the given location.
     * If the file exists, load it.
     * It it does not exist, create it.
     */
    function openJSONFile(backend, name, location) {
        backend.find(name, location, function (fileDescriptor) {
            if (fileDescriptor) {
                backend.load(fileDescriptor);
            }
            else {
                // If no JSON file is available, attempt to extract
                // presentation data from the SVG document, assuming
                // it has been generated from Sozi 13 or earlier.
                // Then save the extracted data to a JSON file.
                presentation.upgrade();

                // Select the first frame
                if (presentation.frames.length) {
                    $.notify("Document was imported from Sozi 13 or earlier.", "success");
                }

                backend.create(name, location, "application/json", getJSONData(), function (fileDescriptor) {
                    autosaveJSON(backend, fileDescriptor);
                });

                controller.onLoad();
            }
        });
    }

    /*
     * Configure autosaving for presentation data
     * and editor state.
     */
    function autosaveJSON(backend, fileDescriptor) {
        var jsonNeedsSaving = false;

        jsonSources.forEach(function (object) {
            object.addListener("contentChange", function () {
                jsonNeedsSaving = true;
            });
        });

        backend.autosave(fileDescriptor, function () { return jsonNeedsSaving; }, getJSONData);

        backend.addListener("save", function (backend, savedFileDescriptor) {
            if (fileDescriptor === savedFileDescriptor) {
                jsonNeedsSaving = false;
                $.notify("Saved " + backend.getName(fileDescriptor), "info");
            }
        });
    }

    /*
     * Extract the data to save from the current presentation
     * and the current editor state.
     * Return it as a JSON string.
     */
    function getJSONData() {
        var storable = {};
        jsonSources.forEach(function (object) {
            var partial = object.toStorable();
            for (var key in partial) {
                storable[key] = partial[key];
            }
        });
        return JSON.stringify(storable);
    }

    /*
     * Load the presentation and set the initial state
     * of the editor using the given JSON data.
     */
    function loadJSONData(data) {
        var storable = JSON.parse(data);
        presentation.fromStorable(storable);
        timeline.fromStorable(storable);
        selection.fromStorable(storable);
        controller.onLoad();
    }

    /*
     * Create the exported HTML file if it does not exist.
     */
    function createHTMLFile(backend, name, location) {
        backend.find(name, location, function (fileDescriptor) {
            if (fileDescriptor) {
                autosaveHTML(backend, fileDescriptor);
            }
            else {
                backend.create(name, location, "text/html", exportHTML(), function (fileDescriptor) {
                    autosaveHTML(backend, fileDescriptor);
                });
            }
        });
    }

    /*
     * Generate the content of the exported HTML file.
     */
    function exportHTML() {
        return nunjucks.render("build/templates/sozi.player.html", {
            svg: svgData,
            title: presentation.title,
            json: JSON.stringify(presentation.toMinimalStorable())
        });
    }

    /*
     * Configure autosaving for HTML export.
     */
    function autosaveHTML(backend, fileDescriptor) {
        var htmlNeedsSaving = false;

        presentation.addListener("contentChange", function () {
            htmlNeedsSaving = true;
        });

        backend.autosave(fileDescriptor, function () { return htmlNeedsSaving; }, exportHTML);

        backend.addListener("save", function (backend, savedFileDescriptor) {
            if (fileDescriptor === savedFileDescriptor) {
                htmlNeedsSaving = false;
                $.notify("Saved " + backend.getName(fileDescriptor), "info");
            }
        });
    }

    var svgFileDescriptor;

    sozi.editor.backend.list.forEach(function (backend) {
        var listItem = $("<li></li>");
        $("#sozi-editor-view-preview ul").append(listItem);
        backend
            .addListener("load", function (backend, fileDescriptor, data, err) {
                var name = backend.getName(fileDescriptor);
                var location = backend.getLocation(fileDescriptor);

                if (err) {
                    $.notify("File " + name + " could not be loaded.", "error");
                }
                else if (/\.svg$/.test(name)) {
                    loadSVG(data);
                    if (svgData) {
                        svgFileDescriptor = fileDescriptor;

                        openJSONFile(backend, name.replace(/\.svg$/, ".sozi.json"), location);
                        createHTMLFile(backend, name.replace(/\.svg$/, ".sozi.html"), location);
                    }
                }
                else if (/\.sozi\.json$/.test(name)) {
                    // Load presentation data and editor state from JSON file.
                    loadJSONData(data);

                    // If no frame is selected, select the first frame
                    if (presentation.frames.length && !selection.selectedFrames.length) {
                        selection.selectedFrames.push(presentation.frames.first);
                    }

                    autosaveJSON(backend, fileDescriptor);
                }
            })
            .addListener("change", function (backend, fileDescriptor) {
                if (fileDescriptor === svgFileDescriptor) {
                    $.notify("Document was changed. Reloading", "info");
                    backend.load(fileDescriptor);
                }
            })
            .init(listItem);
    });
}, false);
