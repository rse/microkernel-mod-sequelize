/*
**  Microkernel -- Microkernel for Server Applications
**  Copyright (c) 2016-2018 Ralf S. Engelschall <rse@engelschall.com>
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
const Sequelize = require("sequelize")

/*  the Microkernel module  */
class Module {
    constructor (options = {}) {
        /*  allow database to be configured initially  */
        this.options = Object.assign({}, options)
    }
    get module () {
        /*  identify this module  */
        return {
            name:  "microkernel-mod-sequelize",
            tag:   "SEQUELIZE",
            group: "BASE",
            after: [ "CTX", "OPTIONS" ]
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
                help: "Database Schema Dropping & Auto-Recreation" })
            options.push({
                name: "db-pool-min", type: "number", "default": 0,
                help: "Database Connection Pool: Minimum Size" })
            options.push({
                name: "db-pool-max", type: "number", "default": 5,
                help: "Database Connection Pool: Maximum Size" })
            options.push({
                name: "db-pool-idle", type: "number", "default": 10 * 1000,
                help: "Database Connection Pool: Maximum Connection Idle Time" })
            options.push({
                name: "db-pool-acquire", type: "number", "default": 10 * 1000,
                help: "Database Connection Pool: Maximum Connection Acquire Time" })
            options.push({
                name: "db-pool-evict", type: "number", "default": 10 * 1000,
                help: "Database Connection Pool: Maximum Connection Eviction Time" })
            options.push({
                name: "db-query-retry-match", type: "string", "default": "SQLITE_BUSY",
                help: "Database Query Retry: Matching Query" })
            options.push({
                name: "db-query-retry-max", type: "number", "default": 5,
                help: "Database Query Retry: Maximum Count" })
        })
    }
    async prepare (kernel) {
        /*  configure the database connection  */
        let opts = kernel.rs("options:options")

        /*  we operate only in non daemonized mode  */
        if (opts.daemon || opts.daemon_kill)
            return

        let options = {
            operatorsAliases:    false,
            define: {
                freezeTableName: true,
                timestamps:      false
            },
            pool: {
                min:     opts.db_pool_min,
                max:     opts.db_pool_max,
                idle:    opts.db_pool_idle,
                acquire: opts.db_pool_acquire,
                evict:   opts.db_pool_evict
            },
            retry: {
                max:   opts.db_query_retry_max,
                match: opts.db_query_retry_match.split(/\s*,\s*/)
            },
            logging: (msg) => {
                if (!msg.match(/FROM\s+pg_class/))
                    kernel.sv("log", "sequelize", "debug", `DB: ${msg}`)
            }
        }
        options.dialect = opts.db_dialect
        if (opts.db_dialect === "sqlite") {
            opts.db_username = ""
            opts.db_password = ""
            options.host     = ""
            options.port     = ""
            options.storage  = opts.db_database
        }
        else {
            options.host = opts.db_host
            options.port = opts.db_port
        }
        let db = kernel.rs("db", new Sequelize(opts.db_database, opts.db_username, opts.db_password, options))

        /*  open connection to database system  */
        let url
        if (opts.db_dialect === "sqlite")
            url = `${opts.db_dialect}://${opts.db_database}`
        else
            url = `${opts.db_dialect}://${opts.db_username}@${opts.db_host}:${opts.db_port}/${opts.db_database}`
        await db.authenticate().then(() => {
            kernel.sv("log", "sequelize", "info", `opened database connection to ${url}`)
        }).catch((err) => {
            kernel.sv("fatal", `failed to open database connection to ${url}: ${err}`)
            throw err
        })

        /*  allow other modules to extend schema  */
        let dm = kernel.rs("dm", {})
        kernel.hook("sequelize:ddl", "none", db, dm)

        /*  synchronize the defined schema with the RDBMS  */
        if (kernel.rs("ctx:procmode") !== "worker") {
            await db.sync({ force: opts.db_schema_drop ? true : false }).then(() => {
                if (opts.db_schema_drop)
                    kernel.sv("log", "sequelize", "info", "(re)created database schema from scratch")
                else
                    kernel.sv("log", "sequelize", "info", "synchronized existing database schema")
            }, (err) => {
                kernel.sv("fatal", `failed to synchronize database schema: ${err}`)
                throw err
            })
        }
    }
    async release (kernel) {
        /*  we operate only in non daemonized mode  */
        if (kernel.rs("options:options").daemon || kernel.rs("options:options").daemon_kill)
            return

        /*  gracefully close connection on application shutdown  */
        kernel.sv("log", "sequelize", "info", "closing database connection")
        let db = kernel.rs("db")
        await db.close()
    }
}

/*  export the Microkernel module  */
module.exports = Module

