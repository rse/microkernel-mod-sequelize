/*
**  Microkernel -- Microkernel for Server Applications
**  Copyright (c) 2015-2016 Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external requirements  */
import co        from "co"
import sprintf   from "sprintfjs"
import Sequelize from "sequelize"

/*  the Microkernel module  */
export default class Module {
    constructor (options) {
        /*  allow database to be configured initially  */
        this.options = Object.assign({
        }, options || {})
    }
    get module () {
        /*  identify this module  */
        return {
            name:  "microkernel-mod-sequelize",
            tag:   "SEQUELIZE",
            group: "BASE"
        }
    }
    latch (kernel) {
        kernel.latch("options:options", (options) => {
            options.push({
                names: [ "db-dialect" ], type: "string", "default": "postgres",
                help: "Database Dialect", helpArg: "DIALECT" })
            options.push({
                names: [ "db-host" ], type: "string", "default": "localhost",
                help: "Database Host", helpArg: "HOST" })
            options.push({
                names: [ "db-port" ], type: "number", "default": 5432,
                help: "Database Port", helpArg: "PORT" })
            options.push({
                names: [ "db-database" ], type: "string", "default": "example",
                help: "Database Name", helpArg: "NAME" })
            options.push({
                names: [ "db-username" ], type: "string", "default": "example",
                help: "Database Username", helpArg: "USERNAME" })
            options.push({
                names: [ "db-password" ], type: "string", "default": "example",
                help: "Database Password", helpArg: "PASSWORD" })
            options.push({
                name: "db-schema-drop", type: "bool", "default": false,
                help: "Database Schema Dropping & Auto-Recreation." })
        })
    }
    start (kernel) {
        return co(function * () {
            /*  configure the database connection  */
            let opts = kernel.rs("options:options")
            let db = kernel.rs("db", new Sequelize(opts.db_database, opts.db_username, opts.db_password, {
                dialect: opts.db_dialect,
                host:    opts.db_host,
                port:    opts.db_port,
                pool:    { min: 1, max: 8, idle: 10 * 1000 },
                define: {
                    freezeTableName: true,
                    timestamps:      false
                },
                logging: (msg) => {
                    if (!msg.match(/FROM\s+pg_class/))
                        kernel.sv("log", "sequelize", "debug", "DB: " + msg)
                }
            }))

            /*  open connection to database system  */
            let url = sprintf("%s://%s@%s:%d/%s",
                opts.db_dialect, opts.db_username,
                opts.db_host, opts.db_port, opts.db_database)
            yield (new Promise((resolve, reject) => {
                db.authenticate().then(() => {
                    kernel.sv("log", "sequelize", "info", sprintf("opened database connection to %s", url))
                    resolve()
                }).catch((err) => {
                    kernel.sv("fatal", sprintf("failed to establish database connection to %s: %s", url, err))
                    reject(err)
                })
            }))

            /*  allow other modules to extend schema  */
            let dm = kernel.rs("dm", {})
            kernel.hook("sequelize:ddl", "none", db, dm)

            /*  synchronize the defined schema with the RDBMS  */
            yield (new Promise((resolve, reject) => {
                if (kernel.rs("ctx:procmode") !== "worker") {
                    db.sync({ force: opts.db_schema_drop ? true : false }).then(() => {
                        if (opts.db_schema_drop)
                            kernel.sv("log", "sequelize", "info", "(re)created database schema from scratch")
                        else
                            kernel.sv("log", "sequelize", "info", "synchronized existing database schema")
                        resolve()
                    }, (error) => {
                        kernel.sv("fatal", "failed to synchronize database schema: " + error)
                        reject(error)
                    })
                }
                else
                    resolve()
             }))
        }.bind(this))
    }
    stop (kernel) {
        /*  gracefully close connection on application shutdown  */
        kernel.sv("log", "sequelize", "info", "closing database connection")
        let db = kernel.rs("db")
        db.close()
    }
}

